import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Any, Dict, List, Optional
from neo4j import Session
from sse_starlette.sse import ServerSentEvent
from app.agents.copilot_agent import copilot_agent
from app.core.config import settings
from app.core.logging import get_logger
from app.services.rag_service import RAGService

logger = get_logger(__name__)

# In-memory memory storage mapping conversation_id -> message history
CONVERSATION_MEMORY: Dict[str, List[Dict[str, str]]] = {}


class AgentService:
    """Manages conversational session memories, triggers RAG workflows, and streams responses."""

    def get_history(self, conversation_id: str) -> List[Dict[str, str]]:
        """Retrieves history turns for a conversation session."""
        if conversation_id not in CONVERSATION_MEMORY:
            CONVERSATION_MEMORY[conversation_id] = []
        return CONVERSATION_MEMORY[conversation_id]

    def add_message(self, conversation_id: str, role: str, content: str) -> None:
        """Appends a new turn to the conversational session log."""
        history = self.get_history(conversation_id)
        history.append({"role": role, "content": content})
        # Keep only the last 10 messages to prevent token budget exhaustion
        if len(history) > 10:
            CONVERSATION_MEMORY[conversation_id] = history[-10:]

    async def run_chat(
        self,
        query: str,
        conversation_id: Optional[str],
        session: Session
    ) -> Dict[str, Any]:
        """Runs the complete Copilot LangGraph agent pipeline synchronously."""
        conv_id = conversation_id or str(uuid.uuid4())
        history = self.get_history(conv_id)

        inputs = {
            "query": query,
            "conversation_id": conv_id,
            "history": history,
            "query_type": "",
            "entities": [],
            "retrieved_context": {},
            "raw_response": "",
            "answer": "",
            "citations": [],
            "confidence": "medium",
            "session": session
        }

        logger.info("Executing Copilot Agent graph synchronously", query=query, conversation_id=conv_id)
        result = await copilot_agent.ainvoke(inputs)

        # Store in session memory
        self.add_message(conv_id, "user", query)
        self.add_message(conv_id, "assistant", result["answer"])

        return {
            "answer": result["answer"],
            "citations": result["citations"],
            "confidence": result["confidence"],
            "conversation_id": conv_id
        }

    async def stream_chat(
        self,
        query: str,
        conversation_id: Optional[str],
        session: Session
    ) -> AsyncGenerator[ServerSentEvent, None]:
        """Orchestrates real-time token streaming and yields SSE structured chunks.

        Intercepts metadata tags dynamically and emits a structured result block at the end.
        """
        import time
        start_time = time.time()
        
        conv_id = conversation_id or str(uuid.uuid4())
        history = self.get_history(conv_id)

        logger.info("Starting streaming copilot RAG agent execution", query=query, conversation_id=conv_id)

        # Step A: Run Classification and Retrieval to build prompt context
        rag_service = RAGService(session)
        
        yield ServerSentEvent(event="status", data=json.dumps({"message": "Classifying query intent..."}))
        classification = await rag_service.classify_query(query)
        query_type = classification.get("type", "general")
        entities = classification.get("entities", [])
        
        yield ServerSentEvent(event="status", data=json.dumps({"message": "Searching database for vector and graph relations..."}))
        if query_type == "out-of-scope":
            context = {"documents": [], "graph_facts": []}
        else:
            context = await rag_service.retrieve_hybrid_context(query)

        # Step B: Check for mock mode to simulate streaming output
        is_mock = (
            not settings.GEMINI_API_KEY 
            or settings.GEMINI_API_KEY == "mock-key-for-skeleton"
        )
        
        if is_mock:
            # Emit intermediate retrieved items
            yield ServerSentEvent(event="status", data=json.dumps({"message": "Synthesizing response..."}))
            await asyncio.sleep(0.5)
            
            dummy_answer = (
                f"Based on the plant records for the entities, the centrifugal pump parameters "
                f"align with specifications. Under normal operations, systems are maintained [DOC-TEST-01]."
            )
            dummy_citations = [
                {
                    "document_id": "DOC-TEST-01",
                    "document_name": "manual.txt",
                    "snippet": "Normal discharge pressure target parameter is 450 psi."
                }
            ]
            
            # Stream simulated tokens
            for word in dummy_answer.split(" "):
                yield ServerSentEvent(event="token", data=json.dumps({"token": word + " "}))
                await asyncio.sleep(0.08)
                
            # Emit final completed citations
            elapsed_time = time.time() - start_time
            done_payload = {
                "answer": dummy_answer,
                "citations": dummy_citations,
                "confidence": "high",
                "conversation_id": conv_id,
                "execution_time_sec": elapsed_time
            }
            self.add_message(conv_id, "user", query)
            self.add_message(conv_id, "assistant", dummy_answer)
            
            yield ServerSentEvent(event="done", data=json.dumps(done_payload))
            return

        # Step C: Live Google GenAI streaming pipeline
        docs_context = ""
        for d in context.get("documents", []):
            text_segments = "\n---\n".join(d["texts"])
            docs_context += f"Document ID: {d['doc_id']}\nTitle: {d['doc_name']}\nContent:\n{text_segments}\n\n"

        facts_context = "\n".join(context.get("graph_facts", []))
        history_str = "".join([f"{m['role'].capitalize()}: {m['content']}\n" for m in history])

        system_instruction = (
            "You are Marg, a highly skilled AI platform for industrial safety, plant "
            "operations, and engineering maintenance. Answer the user's query accurately using "
            "only the provided document contexts and structural graph facts.\n\n"
            "Instructions:\n"
            "1. Answer the query clearly. Use bullet points and paragraphs where appropriate.\n"
            "2. Cite the documents you reference using inline brackets, e.g. [DOC-102].\n"
            "3. At the end of your response, self-assess your confidence level (high, medium, low) "
            "based on how fully the retrieved documents answer the question. You MUST append a "
            "structured JSON metadata block inside <metadata></metadata> tags at the very end of your response.\n\n"
            "Response Metadata Format:\n"
            "<metadata>\n"
            "{\n"
            "  \"confidence\": \"high\" | \"medium\" | \"low\",\n"
            "  \"citations\": [\n"
            "    {\n"
            "      \"document_id\": \"DOC-102\",\n"
            "      \"document_name\": \"manual.pdf\",\n"
            "      \"snippet\": \"exact brief sentence cited\"\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "</metadata>\n\n"
            "Do not write any text after the closing </metadata> tag."
        )

        prompt = f"""
        Here is the recent conversation history:
        {history_str}

        Here are the structural database facts:
        {facts_context or 'None found.'}

        Here is the document reference text:
        {docs_context or 'No relevant reference texts found.'}

        User Query: {query}
        """

        try:
            from google import genai
            from google.genai import types
            
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            
            response_stream = await client.aio.models.generate_content_stream(
                model=settings.GEMINI_REASONING_MODEL, # gemini-2.5-pro
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.2,
                    max_output_tokens=2048,
                )
            )

            full_text = ""
            answer = ""
            metadata_buffer = ""
            in_metadata = False
            
            yield ServerSentEvent(event="status", data=json.dumps({"message": "Generating response..."}))

            async for chunk in response_stream:
                chunk_text = chunk.text
                if not chunk_text:
                    continue
                
                full_text += chunk_text
                
                # Check if we transitioned into the metadata tag
                if "<metadata>" in chunk_text and not in_metadata:
                    in_metadata = True
                    parts = chunk_text.split("<metadata>")
                    ans_part = parts[0]
                    meta_part = parts[1] if len(parts) > 1 else ""
                    if ans_part:
                        yield ServerSentEvent(event="token", data=json.dumps({"token": ans_part}))
                        answer += ans_part
                    if meta_part:
                        metadata_buffer += meta_part
                    continue
                elif "<metadata>" in full_text and not in_metadata:
                    in_metadata = True
                    continue
                
                if in_metadata:
                    metadata_buffer += chunk_text
                else:
                    answer += chunk_text
                    yield ServerSentEvent(event="token", data=json.dumps({"token": chunk_text}))

            # Parse citations metadata at completion
            citations = []
            confidence = "medium"
            
            # Clean up the metadata buffer if tags are split across chunks
            clean_meta_str = metadata_buffer
            if "</metadata>" in clean_meta_str:
                clean_meta_str = clean_meta_str.split("</metadata>")[0]
            clean_meta_str = clean_meta_str.strip()
            
            # If the parser split didn't align, try standard regex extraction on full_text
            if not clean_meta_str and "<metadata>" in full_text and "</metadata>" in full_text:
                try:
                    clean_meta_str = full_text.split("<metadata>")[1].split("</metadata>")[0].strip()
                except Exception:
                    pass

            if clean_meta_str:
                try:
                    meta = json.loads(clean_meta_str)
                    citations = meta.get("citations", [])
                    confidence = meta.get("confidence", "medium")
                except Exception as e:
                    logger.warning("Failed to parse streamed metadata JSON string", error=str(e), buffer=clean_meta_str)

            elapsed_time = time.time() - start_time
            done_payload = {
                "answer": answer.strip(),
                "citations": citations,
                "confidence": confidence,
                "conversation_id": conv_id,
                "execution_time_sec": elapsed_time
            }

            # Update session memory log
            self.add_message(conv_id, "user", query)
            self.add_message(conv_id, "assistant", answer.strip())

            yield ServerSentEvent(event="done", data=json.dumps(done_payload))

        except Exception as e:
            logger.error("Failed to compile streaming response from Gemini API", error=str(e))
            yield ServerSentEvent(event="error", data=json.dumps({"error": str(e)}))
