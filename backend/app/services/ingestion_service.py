import os
import uuid
from fastapi import UploadFile, BackgroundTasks
from app.core.config import settings
from app.core.logging import get_logger
from app.workers.ingestion_worker import IngestionWorker
from neo4j import Session

logger = get_logger(__name__)


class IngestionService:
    """Orchestrates document ingestion workflow, writing uploaded files and initiating workers."""

    async def ingest_document(
        self,
        file: UploadFile,
        background_tasks: BackgroundTasks,
        session: Session | None = None,
    ) -> str:
        """Saves file to disk and adds processing job to the BackgroundTasks queue."""
        job_id = str(uuid.uuid4())
        file_extension = os.path.splitext(file.filename or "")[1]
        saved_filename = f"{job_id}{file_extension}"
        file_path = os.path.join(settings.UPLOAD_DIR, saved_filename)

        logger.info(
            "Starting ingestion workflow", filename=file.filename, job_id=job_id
        )

        # Save uploaded file
        try:
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
        except Exception as e:
            logger.error("Failed to write uploaded file to disk", error=str(e))
            raise e

        # Register status
        IngestionWorker.start_job(job_id, file.filename or "unknown", session=session)

        # Delegate execution asynchronously to background task
        background_tasks.add_task(IngestionWorker.process_document, job_id, file_path)

        return job_id

    def get_job_status(self, job_id: str, session: Session | None = None) -> dict:
        """Queries the current progress of the ingestion task."""
        if session:
            try:
                persisted = IngestionWorker.get_job_status_from_db(job_id, session)
                if persisted.get("status") != "NOT_FOUND":
                    return persisted
            except Exception as e:
                logger.warning(
                    "Failed to load ingestion job from database",
                    job_id=job_id,
                    error=str(e),
                )
        return IngestionWorker.get_job_status(job_id)

    def list_jobs(self, session: Session, limit: int = 50) -> list[dict]:
        """Lists persisted ingestion jobs, falling back to in-memory state if unavailable."""
        try:
            return IngestionWorker.list_jobs_from_db(session, limit=limit)
        except Exception as e:
            logger.warning(
                "Failed to list persisted ingestion jobs, falling back to memory",
                error=str(e),
            )
            from app.workers.ingestion_worker import INGESTION_JOBS

            jobs = list(INGESTION_JOBS.values())
            return jobs[:limit]

    def delete_document(self, document_id: str, session: Session) -> None:
        """Removes a document from the Neo4j knowledge graph, deletes its metadata records,
        and deletes any associated physical files on disk.
        """
        from app.db.repositories.graph_repository import GraphRepository

        logger.info("Triggering deletion for document asset", document_id=document_id)

        session.run(
            "MATCH (j:IngestionJob {id: $document_id}) DETACH DELETE j",
            document_id=document_id,
        )

        # 1. Database garbage-collected purge
        repo = GraphRepository(session)
        repo.delete_document_and_exclusive_entities(document_id)

        # 2. Clear ingestion worker memory job list if it exists
        from app.workers.ingestion_worker import INGESTION_JOBS

        if document_id in INGESTION_JOBS:
            del INGESTION_JOBS[document_id]

        # 3. Clean up physical file on disk if it was saved as {document_id}.ext
        for ext in [".pdf", ".csv", ".xlsx", ".txt"]:
            file_path = os.path.join(settings.UPLOAD_DIR, f"{document_id}{ext}")
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    logger.info(
                        "Deleted physical document file from storage disk",
                        path=file_path,
                    )
                except Exception as e:
                    logger.error(
                        "Failed to delete physical file", path=file_path, error=str(e)
                    )
