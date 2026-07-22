import asyncio
import json
from fastapi import APIRouter, Depends, Request, HTTPException, File, UploadFile
from neo4j import Session
from sse_starlette.sse import EventSourceResponse
from app.db.neo4j_connection import get_neo4j_session
from app.models.schemas import CopilotChatRequest
from app.services.agent_service import AgentService
from app.services.extraction_service import ExtractionService
from app.db.repositories.graph_repository import GraphRepository
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

@router.post("/transcribe")
async def transcribe_voice(
    file: UploadFile = File(...),
):
    """Takes an audio file upload and returns the transcribed text using Gemini."""
    try:
        content = await file.read()
        mime_type = file.content_type or "audio/webm"
        
        extraction_service = ExtractionService()
        transcription = await extraction_service.transcribe_audio(content, mime_type)
        
        return {"text": transcription}
    except Exception as e:
        logger.error("Error transcribing audio", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/identify-equipment")
async def identify_equipment(
    file: UploadFile = File(...),
    session: Session = Depends(get_neo4j_session)
):
    """Reads equipment tag from an uploaded photo and returns its local graph neighborhood."""
    try:
        content = await file.read()
        extraction_service = ExtractionService()
        
        # 1. Read the tag from the image using Gemini Vision
        mime_type = file.content_type or "image/jpeg"
        tag = await extraction_service.read_equipment_tag_from_image(content, mime_type)
        
        if not tag:
            return {
                "identified_tag": None,
                "matched": False,
                "message": "Couldn't identify a legible equipment tag in this photo — try getting closer to the nameplate or ensure it's not obscured."
            }

        # 2. Fuzzy match against the Neo4j Graph
        lower_term = tag.lower().strip()
        search_query = """
        MATCH (n:Equipment)
        WHERE (n.tag IS NOT NULL AND toLower(n.tag) CONTAINS $lower_term) OR
              (n.display_name IS NOT NULL AND toLower(n.display_name) CONTAINS $lower_term) OR
              (n.id IS NOT NULL AND toLower(n.id) CONTAINS $lower_term)
        RETURN n.id AS node_id
        LIMIT 1
        """
        result = session.run(search_query, lower_term=lower_term).single()
        
        if not result:
            return {
                "identified_tag": tag,
                "matched": False,
                "message": f"Identified tag as '{tag}', but no matching equipment was found in the knowledge graph."
            }
            
        matched_node_id = result["node_id"]
        
        # 3. Get the subgraph around the matched equipment
        graph_repo = GraphRepository(session)
        subgraph = graph_repo.get_subgraph(matched_node_id, max_depth=1)
        
        # Clean up chunk nodes to keep the response light, similar to frontend filter
        filtered_nodes = [n for n in subgraph["nodes"] if "Chunk" not in n["labels"]]
        filtered_ids = {n["id"] for n in filtered_nodes}
        filtered_edges = [e for e in subgraph["edges"] if e["source"] in filtered_ids and e["target"] in filtered_ids]
        
        subgraph["nodes"] = filtered_nodes
        subgraph["edges"] = filtered_edges
        
        return {
            "identified_tag": tag,
            "matched": True,
            "matched_node_id": matched_node_id,
            "subgraph": subgraph
        }
    except Exception as e:
        logger.error("Error identifying equipment", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
