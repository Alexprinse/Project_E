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
    """Reads equipment tags from an uploaded photo and returns matching graph neighborhoods."""
    try:
        content = await file.read()
        extraction_service = ExtractionService()
        
        # 1. Read tags from the image using Gemini Vision
        mime_type = file.content_type or "image/jpeg"
        extracted_tags = await extraction_service.read_equipment_tags_from_image(content, mime_type)
        
        if not extracted_tags:
            return {
                "identified_tags": [],
                "identified_tag": None,
                "matched": False,
                "matches": [],
                "unmatched_tags": [],
                "message": "Couldn't identify any legible equipment tags in this photo — try getting closer to the nameplate or ensure it's not obscured."
            }

        graph_repo = GraphRepository(session)
        matches = []
        unmatched_tags = []
        matched_node_ids = set()

        search_query = """
        MATCH (n:Equipment)
        WHERE (n.tag IS NOT NULL AND toLower(n.tag) = $lower_term) OR
              (n.display_name IS NOT NULL AND toLower(n.display_name) = $lower_term) OR
              (n.id IS NOT NULL AND toLower(n.id) = $lower_term) OR
              (n.tag IS NOT NULL AND toLower(n.tag) CONTAINS $lower_term) OR
              (n.display_name IS NOT NULL AND toLower(n.display_name) CONTAINS $lower_term) OR
              (n.id IS NOT NULL AND toLower(n.id) CONTAINS $lower_term)
        RETURN coalesce(n.id, n.tag, n.display_name, elementId(n)) AS node_id, n.tag AS tag, n.display_name AS display_name
        LIMIT 5
        """

        # 2. Match each extracted tag individually
        for tag_str in extracted_tags:
            lower_term = tag_str.lower().strip()
            results = session.run(search_query, lower_term=lower_term).data()
            
            if not results:
                unmatched_tags.append(tag_str)
                continue

            tag_matched_nodes = False
            for record in results:
                node_id = record["node_id"]
                if node_id in matched_node_ids:
                    tag_matched_nodes = True
                    continue
                
                matched_node_ids.add(node_id)
                tag_matched_nodes = True

                # Fetch subgraph around matched equipment
                subgraph = graph_repo.get_subgraph(node_id, max_depth=1)
                filtered_nodes = [n for n in subgraph.get("nodes", []) if "Chunk" not in n.get("labels", [])]
                filtered_ids = {n["id"] for n in filtered_nodes}
                filtered_edges = [e for e in subgraph.get("edges", []) if e.get("source") in filtered_ids and e.get("target") in filtered_ids]

                subgraph["nodes"] = filtered_nodes
                subgraph["edges"] = filtered_edges

                matches.append({
                    "tag": tag_str,
                    "matched_node_id": node_id,
                    "subgraph": subgraph
                })
            
            if not tag_matched_nodes and tag_str not in unmatched_tags:
                unmatched_tags.append(tag_str)

        is_matched = len(matches) > 0
        joined_tags = ", ".join(extracted_tags)

        if not is_matched:
            message = f"Identified {len(extracted_tags)} tag(s) ({joined_tags}), but no matching equipment was found in the knowledge graph."
        elif unmatched_tags:
            message = f"Found {len(matches)} matching equipment item(s) in graph ({len(unmatched_tags)} tag(s) not in graph: {', '.join(unmatched_tags)})."
        else:
            message = f"Successfully matched all {len(matches)} identified equipment item(s) in the knowledge graph."

        return {
            "identified_tags": extracted_tags,
            "identified_tag": matches[0]["tag"] if matches else joined_tags,
            "matched": is_matched,
            "matched_node_id": matches[0]["matched_node_id"] if matches else None,
            "subgraph": matches[0]["subgraph"] if matches else None,
            "matches": matches,
            "unmatched_tags": unmatched_tags,
            "message": message
        }
    except Exception as e:
        logger.error("Error identifying equipment", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
