import asyncio
import os
from typing import Dict, Any, List
from neo4j import Session
from app.core.logging import get_logger
from app.db.neo4j_connection import neo4j_service
from app.db.repositories.graph_repository import GraphRepository
from app.services.embedding_service import EmbeddingService
from app.services.extraction_service import ExtractionService
from app.models.extraction import ExtractionResult

logger = get_logger(__name__)

# In-memory status tracker for ingestion progress
INGESTION_JOBS: Dict[str, Dict[str, Any]] = {}


class IngestionWorker:
    """Orchestrates document ingestion background workflows: parsing, chunking, extraction, and embedding."""

    @staticmethod
    def get_job_status(job_id: str) -> Dict[str, Any]:
        """Retrieves active job execution progress."""
        return INGESTION_JOBS.get(job_id, {"status": "NOT_FOUND"})

    @classmethod
    def start_job(cls, job_id: str, file_name: str) -> None:
        """Registers a new background execution thread state."""
        INGESTION_JOBS[job_id] = {
            "id": job_id,
            "file_name": file_name,
            "status": "QUEUED",
            "progress": 0,
            "error": None,
        }
        logger.info("Ingestion job initialized", job_id=job_id, file=file_name)

    @classmethod
    async def process_document(cls, job_id: str, file_path: str) -> None:
        """Executes the ingestion workflow in isolation."""
        if job_id not in INGESTION_JOBS:
            cls.start_job(job_id, os.path.basename(file_path))

        job = INGESTION_JOBS[job_id]
        job["status"] = "PROCESSING"
        logger.info("Processing document ingestion", job_id=job_id, path=file_path)

        try:
            extraction_service = ExtractionService()
            embedding_service = EmbeddingService()
            
            # Step 1: Parse Document
            job["progress"] = 15
            logger.info("Step 1: Parsing file contents", job_id=job_id)
            
            file_ext = os.path.splitext(file_path)[1].lower()
            is_image = file_ext in [".png", ".jpg", ".jpeg", ".ppm"]
            
            parsed_text = ""
            image_bytes = None
            
            if is_image:
                if file_ext == ".ppm":
                    try:
                        from PIL import Image
                        import io
                        logger.info("Input is PPM image, converting to PNG in-memory for Gemini Vision", job_id=job_id)
                        with Image.open(file_path) as img:
                            png_bio = io.BytesIO()
                            img.save(png_bio, format="PNG")
                            image_bytes = png_bio.getvalue()
                    except Exception as err:
                        logger.error("Failed to convert PPM to PNG, falling back to raw bytes", error=str(err))
                        with open(file_path, "rb") as img_file:
                            image_bytes = img_file.read()
                else:
                    with open(file_path, "rb") as img_file:
                        image_bytes = img_file.read()
                logger.info("Input recognized as image, preparing vision model input", job_id=job_id)
            else:
                # Text-based document parsing
                try:
                    from unstructured.partition.auto import partition
                    logger.info("Invoking Unstructured auto-partitioner", path=file_path)
                    elements = partition(filename=file_path)
                    parsed_text = "\n".join([str(el) for el in elements])
                except Exception as ex:
                    logger.warning("Unstructured library partition failed, falling back to raw reading", error=str(ex))
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as txt_file:
                        parsed_text = txt_file.read()

            # Step 2: Document Chunking
            job["progress"] = 30
            logger.info("Step 2: Partitioning text into semantic window chunks", job_id=job_id)
            
            chunks: List[str] = []
            if is_image:
                # Image documents are processed as a single visual unit
                chunks = ["[Visual document analysis: base64 image data submitted to Gemini]"]
            else:
                chunks = extraction_service.chunk_text(parsed_text)
                if not chunks:
                    chunks = ["[Empty document text context]"]

            # Step 3: Structured Knowledge Extraction using Gemini 2.5
            job["progress"] = 55
            logger.info("Step 3: Extracting engineering entities and links via Gemini 2.5", job_id=job_id)
            
            # Aggregate structures extracted from each chunk
            merged_result = ExtractionResult()
            
            if is_image and image_bytes:
                # Direct vision model API structured extraction
                extraction = await extraction_service.extract_structured_data(
                    image_bytes=image_bytes,
                    mime_type="image/jpeg" if file_ext == ".jpg" or file_ext == ".jpeg" else "image/png"
                )
                cls._merge_extraction_blocks(merged_result, extraction)
            else:
                for idx, chunk in enumerate(chunks):
                    logger.info("Extracting chunk", index=idx, total=len(chunks))
                    extraction = await extraction_service.extract_structured_data(text_content=chunk)
                    cls._merge_extraction_blocks(merged_result, extraction)

            # Step 4: Generate Embeddings using Voyage AI
            job["progress"] = 75
            logger.info("Step 4: Compiling chunk vectors via Voyage AI", job_id=job_id, count=len(chunks))
            embeddings = await embedding_service.get_embeddings(chunks)

            # Step 5: Save Graph State to Neo4j
            job["progress"] = 90
            logger.info("Step 5: Writing graph node/relation transaction blocks to Neo4j", job_id=job_id)
            
            session = neo4j_service.get_session()
            try:
                graph_repo = GraphRepository(session)
                
                # A. Write parent document node
                doc_node_props = {
                    "name": os.path.basename(file_path),
                    "path": file_path,
                    "type": "Image" if is_image else "Text",
                }
                graph_repo.merge_node(label="Document", entity_id=job_id, properties=doc_node_props)
                
                # B. Write semantic chunk nodes and their vector bindings
                for idx, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
                    chunk_id = f"{job_id}-chunk-{idx}"
                    graph_repo.write_chunk(
                        chunk_id=chunk_id,
                        doc_id=job_id,
                        text=chunk_text,
                        index=idx,
                        embedding=embedding
                    )
                
                # C. Save Core Extracted Entities
                for eq in merged_result.equipments:
                    graph_repo.merge_node("Equipment", eq.tag, eq.model_dump(exclude={"tag"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Equipment",
                            source_id=eq.tag,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="HAS_DOCUMENT",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link Equipment to raw document", tag=eq.tag, error=str(e))
                for doc in merged_result.documents:
                    graph_repo.merge_node("Document", doc.id, doc.model_dump(exclude={"id"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Document",
                            source_id=job_id,
                            target_label="Document",
                            target_id=doc.id,
                            rel_type="HAS_DOCUMENT",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link raw document to extracted document entity", doc_id=doc.id, error=str(e))
                for p in merged_result.people:
                    graph_repo.merge_node("Person", p.name, p.model_dump(exclude={"name"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Person",
                            source_id=p.name,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link Person to raw document", name=p.name, error=str(e))
                for loc in merged_result.locations:
                    graph_repo.merge_node("Location", loc.name, loc.model_dump(exclude={"name"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Location",
                            source_id=loc.name,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link Location to raw document", name=loc.name, error=str(e))
                for param in merged_result.process_parameters:
                    graph_repo.merge_node("ProcessParameter", param.name, param.model_dump(exclude={"name"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="ProcessParameter",
                            source_id=param.name,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link ProcessParameter to raw document", name=param.name, error=str(e))
                
                # Save Supplementary/Placeholder entities if extracted (NCRs, WorkOrders, etc.)
                for wo in merged_result.work_orders:
                    graph_repo.merge_node("WorkOrder", wo.id, wo.model_dump(exclude={"id"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="WorkOrder",
                            source_id=wo.id,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link WorkOrder to raw document", id=wo.id, error=str(e))
                for f in merged_result.failures:
                    graph_repo.merge_node("Failure", f.id, f.model_dump(exclude={"id"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Failure",
                            source_id=f.id,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link Failure to raw document", id=f.id, error=str(e))
                for inf in merged_result.inspection_findings:
                    graph_repo.merge_node("InspectionFinding", inf.id, inf.model_dump(exclude={"id"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="InspectionFinding",
                            source_id=inf.id,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link InspectionFinding to raw document", id=inf.id, error=str(e))
                for proc in merged_result.procedures:
                    graph_repo.merge_node("Procedure", proc.id, proc.model_dump(exclude={"id"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Procedure",
                            source_id=proc.id,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link Procedure to raw document", id=proc.id, error=str(e))
                for reg in merged_result.regulations:
                    graph_repo.merge_node("Regulation", reg.code, reg.model_dump(exclude={"code"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="Regulation",
                            source_id=reg.code,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link Regulation to raw document", code=reg.code, error=str(e))
                for nc in merged_result.non_conformances:
                    graph_repo.merge_node("NonConformance", nc.id, nc.model_dump(exclude={"id"}))
                    try:
                        graph_repo.merge_relationship(
                            source_label="NonConformance",
                            source_id=nc.id,
                            target_label="Document",
                            target_id=job_id,
                            rel_type="RELATES_TO",
                            properties={}
                        )
                    except Exception as e:
                        logger.warning("Failed to link NonConformance to raw document", id=nc.id, error=str(e))
                
                # D. Save Relationships
                for rel in merged_result.relationships:
                    try:
                        graph_repo.merge_relationship(
                            source_label=rel.source_label,
                            source_id=rel.source_id,
                            target_label=rel.target_label,
                            target_id=rel.target_id,
                            rel_type=rel.type,
                            properties=rel.properties
                        )
                    except Exception as e:
                        # Log and skip single relationship failures if nodes are missing
                        logger.warning(
                            "Failed to write relationship link (skipping)",
                            source=rel.source_id,
                            target=rel.target_id,
                            type=rel.type,
                            error=str(e)
                        )
                        
            finally:
                session.close()

            # Ingestion Complete
            job["progress"] = 100
            job["status"] = "COMPLETED"
            logger.info(
                "Ingestion pipeline completed successfully",
                job_id=job_id,
                equipments=len(merged_result.equipments),
                locations=len(merged_result.locations),
                relationships=len(merged_result.relationships)
            )

        except Exception as e:
            job["status"] = "FAILED"
            job["error"] = str(e)
            logger.error("Ingestion pipeline execution aborted with failure", job_id=job_id, error=str(e))
            raise e

    @classmethod
    def _merge_extraction_blocks(cls, target: ExtractionResult, source: ExtractionResult) -> None:
        """Appends extracted node arrays from chunk pipelines to the primary collector object."""
        target.equipments.extend(source.equipments)
        target.documents.extend(source.documents)
        target.people.extend(source.people)
        target.locations.extend(source.locations)
        target.process_parameters.extend(source.process_parameters)
        target.work_orders.extend(source.work_orders)
        target.failures.extend(source.failures)
        target.inspection_findings.extend(source.inspection_findings)
        target.procedures.extend(source.procedures)
        target.regulations.extend(source.regulations)
        target.non_conformances.extend(source.non_conformances)
        target.relationships.extend(source.relationships)
