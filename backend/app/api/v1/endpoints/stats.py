from fastapi import APIRouter, Depends
from neo4j import Session

from app.core.logging import get_logger
from app.db.neo4j_connection import get_neo4j_session
from app.models.schemas import IngestionJobResponse, StatsOverviewResponse
from app.workers.ingestion_worker import IngestionWorker

logger = get_logger(__name__)
router = APIRouter()


def _scalar(session: Session, query: str, key: str) -> int:
    try:
        record = session.run(query).single()
        return int(record[key]) if record and record[key] is not None else 0
    except Exception as e:
        logger.warning("Stats aggregate query failed", key=key, error=str(e))
        return 0


def _vector_index_state(session: Session) -> str | None:
    try:
        result = session.run(
            """
            SHOW INDEXES
            YIELD name, state
            WHERE name = 'chunk_embeddings'
            RETURN state
            LIMIT 1
            """
        )
        record = result.single()
        return record["state"] if record else None
    except Exception as e:
        logger.warning("Failed to inspect vector index state", error=str(e))
        return None


@router.get("/overview", response_model=StatsOverviewResponse)
def get_stats_overview(
    session: Session = Depends(get_neo4j_session),
) -> StatsOverviewResponse:
    """Returns live dashboard summary metrics from Neo4j."""
    database_connected = False
    try:
        record = session.run("RETURN 1 AS val").single()
        database_connected = bool(record and record["val"] == 1)
    except Exception as e:
        logger.warning("Stats health probe failed", error=str(e))

    recent_jobs = []
    try:
        recent_jobs = IngestionWorker.list_jobs_from_db(session, limit=5)
    except Exception as e:
        logger.warning("Failed to load recent ingestion jobs for stats", error=str(e))

    return StatsOverviewResponse(
        document_count=_scalar(
            session,
            """
            MATCH (d:Document)-[:HAS_CHUNK]->(:Chunk)
            RETURN count(DISTINCT d) as count
            """,
            "count",
        ),
        entity_count=_scalar(
            session,
            """
            MATCH (n)
            WHERE NOT n:Document AND NOT n:Chunk AND NOT n:IngestionJob AND NOT n:QueryLog
            RETURN count(n) as count
            """,
            "count",
        ),
        chunk_count=_scalar(
            session, "MATCH (c:Chunk) RETURN count(c) as count", "count"
        ),
        failure_count=_scalar(
            session, "MATCH (f:Failure) RETURN count(f) as count", "count"
        ),
        active_ingestion_jobs=_scalar(
            session,
            """
            MATCH (j:IngestionJob)
            WHERE j.status IN ['QUEUED', 'PROCESSING']
            RETURN count(j) as count
            """,
            "count",
        ),
        completed_ingestion_jobs=_scalar(
            session,
            "MATCH (j:IngestionJob {status: 'COMPLETED'}) RETURN count(j) as count",
            "count",
        ),
        failed_ingestion_jobs=_scalar(
            session,
            "MATCH (j:IngestionJob {status: 'FAILED'}) RETURN count(j) as count",
            "count",
        ),
        database_connected=database_connected,
        vector_index_state=_vector_index_state(session),
        recent_jobs=[
            IngestionJobResponse(
                id=job["id"],
                file_name=job["file_name"],
                status=job["status"],
                progress=job["progress"],
                error=job.get("error"),
                created_at=job.get("created_at"),
                updated_at=job.get("updated_at"),
            )
            for job in recent_jobs
        ],
    )
