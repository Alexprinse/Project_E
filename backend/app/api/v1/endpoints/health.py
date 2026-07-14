from fastapi import APIRouter, Depends
from neo4j import Session
from app.db.neo4j_connection import get_neo4j_session
from app.models.schemas import HealthCheckResponse

router = APIRouter()


@router.get("", response_model=HealthCheckResponse)
def health_check(session: Session = Depends(get_neo4j_session)) -> HealthCheckResponse:
    """Verifies backend API operational status and validates connection pool health of Neo4j."""
    db_ok = False
    try:
        # Run a simple Cypher query to assert database connectivity
        result = session.run("RETURN 1 AS val")
        record = result.single()
        if record and record["val"] == 1:
            db_ok = True
    except Exception:
        db_ok = False

    return HealthCheckResponse(
        status="ok" if db_ok else "degraded",
        database_connected=db_ok
    )
