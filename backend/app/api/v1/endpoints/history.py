from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import Session
from app.db.neo4j_connection import get_neo4j_session
from app.db.repositories.history_repository import HistoryRepository
from app.models.schemas import HistoryListResponse, HistoryDeleteResponse
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()


@router.get("", response_model=HistoryListResponse)
def list_history(
    limit: int = Query(50, ge=1, le=200, description="Max entries to return"),
    session: Session = Depends(get_neo4j_session),
) -> HistoryListResponse:
    """Returns the most recent Copilot/RCA query-answer audit log entries, newest first.

    This is a human-review audit trail only - it is never read back into the RAG/RCA
    retrieval or reasoning paths.
    """
    repo = HistoryRepository(session)
    entries = repo.list_recent(limit=limit)
    return HistoryListResponse(entries=entries, count=len(entries))


@router.delete("", response_model=HistoryDeleteResponse)
def clear_history(session: Session = Depends(get_neo4j_session)) -> HistoryDeleteResponse:
    """Deletes ALL history entries. Irreversible - intended for demo/reset cleanup."""
    repo = HistoryRepository(session)
    deleted = repo.delete_all()
    logger.info("Cleared all query history entries", deleted_count=deleted)
    return HistoryDeleteResponse(success=True, deleted_count=deleted)


@router.delete("/{entry_id}", response_model=HistoryDeleteResponse)
def delete_history_entry(
    entry_id: str, session: Session = Depends(get_neo4j_session)
) -> HistoryDeleteResponse:
    """Deletes a single history entry by id."""
    repo = HistoryRepository(session)
    deleted = repo.delete_entry(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="History entry not found.")
    return HistoryDeleteResponse(success=True, deleted_count=1)
