import asyncio
import json
import time
from collections.abc import AsyncGenerator
from typing import Any, Dict, List, Optional
from neo4j import Session
from sse_starlette.sse import ServerSentEvent
from app.core.config import settings
from app.core.logging import get_logger
from app.agents.rca_agent import rca_agent
from app.db.repositories.history_repository import HistoryRepository

logger = get_logger(__name__)


class RCAService:
    """Manages context gathering and token streaming for Root Cause Analysis (RCA) reports."""

    def _log_history(
        self,
        session: Session,
        query_text: str,
        answer_text: str,
        citations: List[Dict[str, Any]],
        confidence: Optional[str],
        execution_time_sec: Optional[float],
    ) -> None:
        """Best-effort write to the audit history log. Never raises - a logging failure must
        not break the user-facing RCA response."""
        try:
            HistoryRepository(session).log_query(
                query_type="rca",
                query_text=query_text,
                answer_text=answer_text,
                citations=citations,
                confidence=confidence,
                execution_time_sec=execution_time_sec,
            )
        except Exception as e:
            logger.warning("Failed to write RCA analysis to audit history", error=str(e))

    async def get_all_failures(self, session: Session) -> List[Dict[str, Any]]:
        """Queries Neo4j for all Failure nodes with display name, severity, date, description, and linked equipment tags."""
        query = """
        MATCH (f:Failure)
        OPTIONAL MATCH (f)-[:OCCURRED_ON|PERFORMED_ON]-(e:Equipment)
        WITH f, e LIMIT 100
        RETURN f.id as id, f.date as date, f.severity as severity, f.description as description,
               collect(DISTINCT e.tag) as equipment_tags, collect(DISTINCT e.display_name) as equipment_displays
        """
        logger.info("Fetching all failures from graph")
        res = session.run(query)
        failures = []
        for rec in res:
            tags = rec["equipment_tags"]
            displays = rec["equipment_displays"]
            failures.append({
                "id": rec["id"],
                "date": rec["date"],
                "severity": rec["severity"],
                "description": rec["description"],
                "equipment_tag": tags[0] if tags else None,
                "equipment_display": displays[0] if displays else None
            })
        return failures

    async def stream_rca(self, failure_id: str, session: Session) -> AsyncGenerator[ServerSentEvent, None]:
        """Runs context loading and streams structured Root Cause Analysis report via SSE."""
        start_time = time.time()
        logger.info("Starting streaming RCA generation", failure_id=failure_id)

        # Step A: Load context
        yield ServerSentEvent(event="status", data=json.dumps({"message": "Retrieving failure subgraphs and related documents..."}))
        
        # Invoke LangGraph load_context logic or query database directly
        # For simplicity, we call the node handler directly or use the agent to load it
        agent_inputs = {
            "failure_id": failure_id,
            "context": {},
            "raw_response": "",
            "answer": "",
            "citations": [],
            "confidence": "medium",
            "session": session
        }
        
        from app.agents.rca_agent import load_failure_context_node
        node_result = await load_failure_context_node(agent_inputs)
        context = node_result["context"]

        if not context.get("failure"):
            yield ServerSentEvent(event="error", data=json.dumps({"error": f"Failure ID {failure_id} not found."}))
            return

        # Step B: Check for mock mode
        is_mock = (
            not settings.GEMINI_API_KEY 
            or settings.GEMINI_API_KEY == "mock-key-for-skeleton"
        )

        if is_mock:
            yield ServerSentEvent(event="status", data=json.dumps({"message": "Generating structured RCA report..."}))
            await asyncio.sleep(0.5)

            dummy_answer = (
                "### Root Cause\n"
                "Sulfidation corrosion induced thinning led to catastrophic piping rupture on 4-sidecut piping [csb-chevron-9eaa97].\n\n"
                "### Contributing Factors\n"
                "Low-silicon carbon steel was used instead of high-chromium alloys [csb-chevron-9eaa97].\n\n"
                "### Affected Equipment\n"
                "- 4-sidecut piping (Piping Circuit)\n\n"
                "### Related Regulations\n"
                "- API 570 (Piping Inspection Code)\n\n"
                "### Recommended Action\n"
                "Implement 100% component alloy verification for all carbon steel piping [csb-chevron-9eaa97]."
            )
            dummy_citations = [
                {
                    "document_id": "csb-chevron-9eaa97",
                    "document_name": "chevron_final_investigation_report.pdf",
                    "snippet": "piping was found to have low silicon content making it susceptible to sulfidation."
                }
            ]

            for word in dummy_answer.split(" "):
                yield ServerSentEvent(event="token", data=json.dumps({"token": word + " "}))
                await asyncio.sleep(0.08)

            elapsed_time = time.time() - start_time
            done_payload = {
                "answer": dummy_answer,
                "citations": dummy_citations,
                "confidence": "high",
                "conversation_id": f"rca-{failure_id}",
                "execution_time_sec": elapsed_time
            }
            self._log_history(
                session=session,
                query_text=f"RCA analysis: {failure_id}",
                answer_text=dummy_answer,
                citations=dummy_citations,
                confidence="high",
                execution_time_sec=elapsed_time,
            )
            yield ServerSentEvent(event="done", data=json.dumps(done_payload))
            return

        # Step C: Live Google GenAI streaming pipeline
        f_props = context["failure"]
        failure_str = (
            f"Event ID: {f_props.get('id')}\n"
            f"Date: {f_props.get('date', 'Unknown')}\n"
            f"Severity: {f_props.get('severity', 'Unknown')}\n"
            f"Initial Root Cause: {f_props.get('root_cause', 'Unknown')}\n"
            f"Description: {f_props.get('description', 'Unknown')}\n"
        )

        equip_str = ""
        for eq in context["equipments"]:
            display_name = eq.get("display_name") or eq.get("tag")
            equip_str += (
                f"- Tag: {eq.get('tag')} (Display Name: {display_name}, Type: {eq.get('type', 'Unknown')}, "
                f"Location: {eq.get('location', 'Unknown')}, Criticality: {eq.get('criticality', 'Unknown')})\n"
            )
        if not equip_str:
            equip_str = "None found in graph."

        work_str = ""
        for item in context["linked_items"]:
            props = item["properties"]
            work_str += f"- [{item['label']}] ID: {props.get('id')} - {props.get('description', props.get('outcome', 'No details'))}\n"
        if not work_str:
            work_str = "None found in graph."

        reg_str = ""
        for r in context["regulations"]:
            reg_str += f"- {r.get('display_name', r.get('code'))}: {r.get('requirement_text', 'No requirement text')}\n"
        if not reg_str:
            reg_str = "None found in graph."

        docs_str = ""
        for d in context["documents"]:
            text_segments = "\n---\n".join(d["texts"])
            docs_str += f"Document ID: {d['doc_id']}\nTitle: {d['doc_name']}\nContent:\n{text_segments}\n\n"
        if not docs_str:
            docs_str = "No reference text documents connected."

        system_instruction = (
            "You are Marg, an industrial operations expert specializing in Root Cause Analysis (RCA).\n"
            "Your task is to analyze the provided Failure details, connected equipment, linked work orders/inspection findings, "
            "regulations, and source document chunks, and generate a structured RCA report.\n\n"
            "Instructions:\n"
            "1. You MUST organize your report into exactly these five sections, using these headers:\n"
            "   ### Root Cause\n"
            "   [State primary technical/mechanical cause. Ground this in details from the chunks. Always use human-readable equipment display names, e.g. '4-sidecut piping' rather than normalized tag keys like '4sidecutpiping'.]\n\n"
            "   ### Contributing Factors\n"
            "   [State organizational, procedural, or secondary factors. Ground this in the chunks. Reference equipment by human-readable display names, not normalized tag keys.]\n\n"
            "   ### Affected Equipment\n"
            "   [List of equipment display names and details from the physical graph relationships. Always use the human-readable display name (e.g. '4-sidecut piping') rather than the normalized/squeezed tag (e.g. '4sidecutpiping').]\n\n"
            "   ### Related Regulations\n"
            "   [List of standard code or safety regulation clauses governed by the graph relationships.]\n\n"
            "   ### Recommended Action\n"
            "   [State recommendations grounded strictly in what the source document recommends, rather than inventing generic ones.]\n\n"
            "2. If the graph data is insufficient to support a section (e.g. no WorkOrder or Regulation nodes are linked), "
            "explicitly state in that section: 'No linked database records available for this section.' Do not fabricate contents.\n"
            "3. In all sections of the report, when referencing equipment, always use the human-readable display name (e.g. '4-sidecut piping') rather than the normalized/squeezed tag key.\n"
            "4. Cite every technical claim or finding using inline document brackets, e.g. [DOC-102].\n"
            "5. Self-assess your confidence level (high, medium, low) and append a structured JSON metadata block inside "
            "<metadata></metadata> tags at the very end of your response.\n\n"
            "Response Metadata Format:\n"
            "<metadata>\n"
            "{\n"
            "  \"confidence\": \"high\" | \"medium\" | \"low\",\n"
            "  \"citations\": [\n"
            "    {\n"
            "      \"document_id\": \"DOC-102\",\n"
            "      \"document_name\": \"report.pdf\",\n"
            "      \"snippet\": \"exact sentence cited\"\n"
            "    }\n"
            "  ]\n"
            "}\n"
            "</metadata>\n\n"
            "Do not write any text after the closing </metadata> tag."
        )

        prompt = f"""
        --- FAILURE NODE FACTS ---
        {failure_str}

        --- CONNECTED EQUIPMENT RELATIONSHIPS ---
        {equip_str}

        --- LINKED WORK ORDERS & INSPECTIONS ---
        {work_str}

        --- APPLICABLE CODE REGULATIONS ---
        {reg_str}

        --- RELATED DOCUMENT REFERENCE CHUNKS ---
        {docs_str}

        Based on the facts above, generate the structured RCA report.
        """

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            response_stream = await client.aio.models.generate_content_stream(
                model=settings.GEMINI_REASONING_MODEL,
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

            yield ServerSentEvent(event="status", data=json.dumps({"message": "Generating structured RCA report..."}))

            async for chunk in response_stream:
                chunk_text = chunk.text
                if not chunk_text:
                    continue

                full_text += chunk_text

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

            clean_meta_str = metadata_buffer
            if "</metadata>" in clean_meta_str:
                clean_meta_str = clean_meta_str.split("</metadata>")[0]
            clean_meta_str = clean_meta_str.strip()

            if not clean_meta_str and "<metadata>" in full_text and "</metadata>" in full_text:
                try:
                    clean_meta_str = full_text.split("<metadata>")[1].split("</metadata>")[0].strip()
                except Exception:
                    pass

            if clean_meta_str:
                try:
                    meta = json.loads(clean_meta_str)
                    if isinstance(meta, list):
                        citations = meta
                        confidence = "medium"
                    else:
                        citations = meta.get("citations", [])
                        confidence = meta.get("confidence", "medium")
                except Exception as e:
                    logger.warning("Failed to parse streamed RCA metadata JSON string", error=str(e), buffer=clean_meta_str)

            elapsed_time = time.time() - start_time
            done_payload = {
                "answer": answer.strip(),
                "citations": citations,
                "confidence": confidence,
                "conversation_id": f"rca-{failure_id}",
                "execution_time_sec": elapsed_time
            }
            self._log_history(
                session=session,
                query_text=f"RCA analysis: {failure_id}",
                answer_text=answer.strip(),
                citations=citations,
                confidence=confidence,
                execution_time_sec=elapsed_time,
            )
            yield ServerSentEvent(event="done", data=json.dumps(done_payload))

        except Exception as e:
            logger.error("Failed to compile streaming response for RCA", error=str(e))
            yield ServerSentEvent(event="error", data=json.dumps({"error": str(e)}))
