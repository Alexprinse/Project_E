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
    def _safe_persist_job(job_id: str) -> None:
        """Best-effort persistence for job cache updates."""
        try:
            session = neo4j_service.get_session()
        except Exception as e:
            logger.debug("Skipping ingestion job persistence; Neo4j unavailable", error=str(e))
            return

        try:
            IngestionWorker.persist_job(job_id, session)
        except Exception as e:
            logger.warning("Failed to persist ingestion job state", job_id=job_id, error=str(e))
        finally:
            session.close()

    @staticmethod
    def persist_job(job_id: str, session: Session) -> None:
        """Writes the current in-memory job state to Neo4j."""
        job = INGESTION_JOBS.get(job_id)
        if not job:
            return

        query = """
        MERGE (j:IngestionJob {id: $id})
        ON CREATE SET j.created_at = timestamp()
        SET j.file_name = $file_name,
            j.status = $status,
            j.progress = $progress,
            j.error = $error,
            j.updated_at = timestamp()
        RETURN j.id as id
        """
        session.run(
            query,
            id=job["id"],
            file_name=job["file_name"],
            status=job["status"],
            progress=job["progress"],
            error=job.get("error"),
        )

    @staticmethod
    def get_job_status_from_db(job_id: str, session: Session) -> Dict[str, Any]:
        """Retrieves persisted ingestion job state from Neo4j."""
        query = """
        MATCH (j:IngestionJob {id: $job_id})
        RETURN j.id as id,
               j.file_name as file_name,
               j.status as status,
               j.progress as progress,
               properties(j).error as error,
               j.created_at as created_at,
               j.updated_at as updated_at
        """
        result = session.run(query, job_id=job_id)
        record = result.single()
        if not record:
            return {"status": "NOT_FOUND"}
        return {
            "id": record["id"],
            "file_name": record["file_name"],
            "status": record["status"],
            "progress": record["progress"],
            "error": record["error"],
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
        }

    @staticmethod
    def list_jobs_from_db(session: Session, limit: int = 50) -> List[Dict[str, Any]]:
        """Lists recent persisted ingestion jobs."""
        query = """
        MATCH (j:IngestionJob)
        RETURN j.id as id,
               j.file_name as file_name,
               j.status as status,
               j.progress as progress,
               properties(j).error as error,
               j.created_at as created_at,
               j.updated_at as updated_at
        ORDER BY coalesce(j.updated_at, j.created_at, 0) DESC
        LIMIT $limit
        """
        records = session.run(query, limit=limit)
        return [
            {
                "id": rec["id"],
                "file_name": rec["file_name"],
                "status": rec["status"],
                "progress": rec["progress"],
                "error": rec["error"],
                "created_at": rec["created_at"],
                "updated_at": rec["updated_at"],
            }
            for rec in records
        ]

    @staticmethod
    def get_job_status(job_id: str) -> Dict[str, Any]:
        """Retrieves active job execution progress."""
        return INGESTION_JOBS.get(job_id, {"status": "NOT_FOUND"})

    @classmethod
    def start_job(cls, job_id: str, file_name: str, session: Session | None = None) -> None:
        """Registers a new background execution thread state."""
        INGESTION_JOBS[job_id] = {
            "id": job_id,
            "file_name": file_name,
            "status": "QUEUED",
            "progress": 0,
            "error": None,
        }
        logger.info("Ingestion job initialized", job_id=job_id, file=file_name)
        if session:
            cls.persist_job(job_id, session)
        else:
            cls._safe_persist_job(job_id)

    @classmethod
    def update_job(cls, job_id: str, **updates: Any) -> Dict[str, Any]:
        """Updates cached job state and persists it best-effort."""
        if job_id not in INGESTION_JOBS:
            cls.start_job(job_id, updates.get("file_name") or "unknown")
        INGESTION_JOBS[job_id].update(updates)
        cls._safe_persist_job(job_id)
        return INGESTION_JOBS[job_id]

    @classmethod
    async def process_document(cls, job_id: str, file_path: str) -> None:
        """Executes the ingestion workflow in isolation."""
        if job_id not in INGESTION_JOBS:
            cls.start_job(job_id, os.path.basename(file_path))

        cls.update_job(job_id, status="PROCESSING")
        logger.info("Processing document ingestion", job_id=job_id, path=file_path)

        try:
            extraction_service = ExtractionService()
            embedding_service = EmbeddingService()
            
            # Step 1: Parse Document
            cls.update_job(job_id, progress=15)
            logger.info("Step 1: Parsing file contents", job_id=job_id)
            
            file_ext = os.path.splitext(file_path)[1].lower()
            is_image = file_ext in [".png", ".jpg", ".jpeg", ".ppm"]
            is_tabular = file_ext in [".xlsx", ".xls", ".csv"]
            
            parsed_text = ""
            image_bytes = None
            chunks: List[str] = []
            
            if is_tabular:
                import pandas as pd
                logger.info("Parsing tabular spreadsheet data", job_id=job_id)
                try:
                    def df_to_markdown(df: Any) -> str:
                        if df.empty:
                            return ""
                        headers = list(df.columns)
                        header_row = "| " + " | ".join(str(h).replace("|", "\\|") for h in headers) + " |"
                        separator_row = "| " + " | ".join(["---"] * len(headers)) + " |"
                        rows = []
                        for _, row in df.iterrows():
                            r = "| " + " | ".join(str(x).replace("|", "\\|").replace("\n", " ") for x in row.values) + " |"
                            rows.append(r)
                        return "\n".join([header_row, separator_row] + rows)

                    chunk_size = 1
                    if file_ext == ".csv":
                        df = pd.read_csv(file_path)
                        for i in range(0, len(df), chunk_size):
                            batch = df.iloc[i:i+chunk_size]
                            md_table = df_to_markdown(batch)
                            chunks.append(f"Sheet: CSV Data\n\n{md_table}")
                    else:
                        xls = pd.ExcelFile(file_path)
                        for sheet_name in xls.sheet_names:
                            df = pd.read_excel(xls, sheet_name=sheet_name)
                            for i in range(0, len(df), chunk_size):
                                batch = df.iloc[i:i+chunk_size]
                                md_table = df_to_markdown(batch)
                                chunks.append(f"Sheet: {sheet_name}\n\n{md_table}")
                except Exception as ex:
                    logger.warning("Tabular parsing failed, falling back", error=str(ex))
                    raise ex
            elif is_image:
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
            cls.update_job(job_id, progress=30)
            logger.info("Step 2: Partitioning text into semantic window chunks", job_id=job_id)
            
            if is_tabular:
                if not chunks:
                    chunks = ["[Empty tabular data]"]
            elif is_image:
                # Image documents are processed by calling Gemini vision to transcribe/describe their content
                img_mime = "image/jpeg" if file_ext == ".jpg" or file_ext == ".jpeg" else "image/png"
                if not image_bytes:
                    raise ValueError("No image bytes available for visual document analysis")
                logger.info("Describing image content using Gemini Vision", job_id=job_id)
                parsed_text = await extraction_service.describe_image(image_bytes, mime_type=img_mime)
                if not parsed_text or "base64 image data" in parsed_text or parsed_text.strip() == "":
                    raise RuntimeError("Visual document analysis failed to produce valid text description")
                chunks = extraction_service.chunk_text(parsed_text)
                if not chunks:
                    chunks = ["[Empty visual description]"]
            else:
                chunks = extraction_service.chunk_text(parsed_text)
                if not chunks:
                    chunks = ["[Empty document text context]"]

            # Step 3: Structured Knowledge Extraction using Gemini 2.5
            cls.update_job(job_id, progress=55)
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
                    extraction = await extraction_service.extract_structured_data(
                        text_content=chunk,
                        is_tabular=is_tabular
                    )
                    cls._merge_extraction_blocks(merged_result, extraction)

            # Step 4: Generate Embeddings using Voyage AI
            cls.update_job(job_id, progress=75)
            logger.info("Step 4: Compiling chunk vectors via Voyage AI", job_id=job_id, count=len(chunks))
            embeddings = await embedding_service.get_embeddings(chunks)

            # Step 5: Save Graph State to Neo4j
            cls.update_job(job_id, progress=90)
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
                        
                        # Explicitly bridge Equipment to Location if present
                        if eq.location:
                            # Ensure the Location node exists
                            graph_repo.merge_node("Location", eq.location, {})
                            graph_repo.merge_relationship(
                                source_label="Equipment",
                                source_id=eq.tag,
                                target_label="Location",
                                target_id=eq.location,
                                rel_type="PART_OF",
                                properties={}
                            )
                    except Exception as e:
                        logger.warning("Failed to link Equipment to raw document or location", tag=eq.tag, error=str(e))
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
            cls.update_job(job_id, progress=100, status="COMPLETED", error=None)
            logger.info(
                "Ingestion pipeline completed successfully",
                job_id=job_id,
                equipments=len(merged_result.equipments),
                locations=len(merged_result.locations),
                relationships=len(merged_result.relationships)
            )

        except Exception as e:
            cls.update_job(job_id, status="FAILED", error=str(e))
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
