import asyncio
import json
from fastapi import APIRouter, Depends, Request, HTTPException
from neo4j import Session
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field
from app.db.neo4j_connection import get_neo4j_session
from app.services.rca_service import RCAService
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()
rca_service = RCAService()


class RCASystemAnalyzeRequest(BaseModel):
    failure_id: str = Field(..., description="ID of the failure node to analyze")


@router.get("/failures")
async def list_failures(session: Session = Depends(get_neo4j_session)):
    """Lists all Failure nodes in the database with basic metadata and linked equipment tags."""
    try:
        failures = await rca_service.get_all_failures(session)
        return {"failures": failures}
    except Exception as e:
        logger.error("Failed to list failures", error=str(e))
        raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")


@router.post("/analyze")
async def analyze_failure(
    payload: RCASystemAnalyzeRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session)
) -> EventSourceResponse:
    """Runs context-loaded Root Cause Analysis (RCA) on the target failure node and streams results via SSE."""
    logger.info("Received RCA analysis streaming request", failure_id=payload.failure_id)

    async def event_generator():
        try:
            async for event in rca_service.stream_rca(
                failure_id=payload.failure_id,
                session=session
            ):
                if await request.is_disconnected():
                    logger.info("Client disconnected prematurely mid-RCA-stream")
                    break
                yield event
        except asyncio.CancelledError:
            logger.info("RCA streaming connection task cancelled")
        except Exception as e:
            logger.error("Error during RCA SSE stream yielding loop", error=str(e))
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return EventSourceResponse(event_generator())
