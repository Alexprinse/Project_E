import asyncio
import json
from fastapi import APIRouter, Depends, Request, HTTPException
from neo4j import Session
from sse_starlette.sse import EventSourceResponse
from app.db.neo4j_connection import get_neo4j_session
from app.models.schemas import CopilotChatRequest
from app.services.agent_service import AgentService
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()
agent_service = AgentService()


@router.post("/query")
async def query_copilot(
    payload: CopilotChatRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session)
) -> EventSourceResponse:
    """Evaluates user queries and returns a Server-Sent Events (SSE) stream.

    Streams answer text tokens in real-time, ending with citations and confidence metrics.
    Handles premature client disconnects gracefully.
    """
    logger.info(
        "Received Copilot streaming query request",
        conversation_id=payload.conversation_id,
        query=payload.query[:40]
    )

    async def event_generator():
        try:
            # Consume the stream from AgentService
            async for event in agent_service.stream_chat(
                query=payload.query,
                conversation_id=payload.conversation_id,
                session=session,
                history_query_type=payload.query_type,
            ):
                # Assert connection is still active before yielding
                if await request.is_disconnected():
                    logger.info("Client disconnected prematurely mid-stream, halting token generation")
                    break
                yield event
        except asyncio.CancelledError:
            logger.info("Streaming connection task cancelled")
        except Exception as e:
            logger.error("Error during SSE stream yielding loop", error=str(e))
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return EventSourceResponse(event_generator())
