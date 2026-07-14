from fastapi import APIRouter, File, UploadFile, BackgroundTasks, HTTPException, Depends
from neo4j import Session
from app.db.neo4j_connection import get_neo4j_session
from app.services.ingestion_service import IngestionService
from app.models.schemas import IngestionTriggerResponse, IngestionStatusResponse

router = APIRouter()
ingestion_service = IngestionService()


@router.post("", response_model=IngestionTriggerResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
) -> IngestionTriggerResponse:
    """Accepts document uploads (PDF, spreadsheet) and triggers background ingestion worker."""
    # Simple validation of file types
    allowed_extensions = {".pdf", ".csv", ".xlsx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".ppm"}
    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format. Supported extensions: {allowed_extensions}"
        )

    job_id = await ingestion_service.ingest_document(file, background_tasks)

    return IngestionTriggerResponse(
        job_id=job_id,
        filename=file.filename or "unknown",
        status="QUEUED",
        message="Document processing initiated in background."
    )


@router.get("/{job_id}", response_model=IngestionStatusResponse)
def get_ingestion_status(job_id: str) -> IngestionStatusResponse:
    """Queries current progress and status of a document ingestion job."""
    status_data = ingestion_service.get_job_status(job_id)
    if status_data.get("status") == "NOT_FOUND":
        raise HTTPException(status_code=404, detail="Ingestion job not found.")

    return IngestionStatusResponse(
        id=status_data["id"],
        file_name=status_data["file_name"],
        status=status_data["status"],
        progress=status_data["progress"],
        error=status_data.get("error")
    )


@router.delete("/{document_id}")
def delete_document(
    document_id: str,
    session: Session = Depends(get_neo4j_session)
):
    """Purges a document asset and its exclusively connected graph entity nodes."""
    try:
        ingestion_service.delete_document(document_id, session)
        return {"success": True, "message": "Document successfully purged from schematic."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

