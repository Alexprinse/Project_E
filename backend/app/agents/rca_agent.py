import json
from typing import Any, Dict, List
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from neo4j import Session
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class RCAAgentState(TypedDict):
    """LangGraph agent state model for Failure node Root Cause Analysis (RCA)."""
    failure_id: str
    context: Dict[str, Any]
    raw_response: str
    answer: str
    citations: List[Dict[str, Any]]
    confidence: str
    session: Session  # Injecting Neo4j session parameter


# ---------------------------------------------------------
# Node 1: Load Context
# ---------------------------------------------------------
async def load_failure_context_node(state: RCAAgentState) -> Dict[str, Any]:
    """Node querying Neo4j for failure details, equipment, work orders, regulations, and chunks."""
    failure_id = state["failure_id"]
    session = state["session"]
    logger.info("LangGraph Node: Loading Failure Context", failure_id=failure_id)

    # 1. Load Failure node
    query_failure = """
    MATCH (f:Failure {id: $failure_id})
    RETURN f {.*} as failure
    """
    res_f = session.run(query_failure, failure_id=failure_id)
    rec_f = res_f.single()
    if not rec_f:
        logger.warning("Failure node not found", failure_id=failure_id)
        return {
            "context": {
                "failure": None,
                "equipments": [],
                "linked_items": [],
                "regulations": [],
                "documents": []
            }
        }
    failure_data = rec_f["failure"]

    # 2. Load OCCURRED_ON equipment
    query_equip = """
    MATCH (f:Failure {id: $failure_id})-[:OCCURRED_ON|PERFORMED_ON]-(e:Equipment)
    RETURN e {.*} as equipment
    """
    res_e = session.run(query_equip, failure_id=failure_id)
    equipments = [rec["equipment"] for rec in res_e]

    # 3. Load LINKED_TO WorkOrders / InspectionFindings
    query_work = """
    MATCH (f:Failure {id: $failure_id})-[:LINKED_TO|RELATES_TO]-(m)
    WHERE m:WorkOrder OR m:InspectionFinding
    RETURN labels(m)[0] as label, m {.*} as properties
    """
    res_w = session.run(query_work, failure_id=failure_id)
    linked_items = [{"label": rec["label"], "properties": rec["properties"]} for rec in res_w]

    # 4. Load Regulations connected via 1..2 hops to Failure or Equipment
    query_regs = """
    MATCH (f:Failure {id: $failure_id})
    OPTIONAL MATCH (f)-[:OCCURRED_ON|PERFORMED_ON]-(e:Equipment)
    WITH f, e
    MATCH (target) WHERE target = f OR target = e
    MATCH (target)-[*1..2]-(r:Regulation)
    RETURN DISTINCT r {.*} as regulation
    """
    res_r = session.run(query_regs, failure_id=failure_id)
    regulations = [rec["regulation"] for rec in res_r]

    # 5. Load chunks linked to the Failure (via Document)
    query_chunks = """
    MATCH (f:Failure {id: $failure_id})-[:RELATES_TO|HAS_DOCUMENT]-(d:Document)-[:HAS_CHUNK]-(c:Chunk)
    RETURN d.id as doc_id, d.name as doc_name, c.text as chunk_text, c.id as chunk_id
    """
    res_c = session.run(query_chunks, failure_id=failure_id)
    documents = {}
    for rec in res_c:
        doc_id = rec["doc_id"]
        doc_name = rec["doc_name"]
        chunk_text = rec["chunk_text"]
        if doc_id not in documents:
            documents[doc_id] = {
                "doc_id": doc_id,
                "doc_name": doc_name,
                "texts": []
            }
        if chunk_text not in documents[doc_id]["texts"]:
            documents[doc_id]["texts"].append(chunk_text)

    context = {
        "failure": failure_data,
        "equipments": equipments,
        "linked_items": linked_items,
        "regulations": regulations,
        "documents": list(documents.values())
    }
    return {"context": context}


# ---------------------------------------------------------
# Node 2: Generate RCA
# ---------------------------------------------------------
async def generate_rca_node(state: RCAAgentState) -> Dict[str, Any]:
    """Node generating structured RCA output via reasoning model."""
    context = state["context"]
    failure_id = state["failure_id"]
    logger.info("LangGraph Node: Generating RCA answer", failure_id=failure_id)

    if not context.get("failure"):
        ans = f"Error: Failure event node '{failure_id}' was not found in the database graph."
        metadata = {"confidence": "low", "citations": []}
        return {
            "raw_response": f"{ans}\n<metadata>{json.dumps(metadata)}</metadata>",
            "answer": ans,
            "citations": [],
            "confidence": "low"
        }

    # Format components for prompt
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

    is_mock = settings.is_gemini_mock

    if is_mock:
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
        dummy_meta = {
            "confidence": "high",
            "citations": [
                {
                    "document_id": "csb-chevron-9eaa97",
                    "document_name": "chevron_final_investigation_report.pdf",
                    "snippet": "piping was found to have low silicon content making it susceptible to sulfidation."
                }
            ]
        }
        raw_res = f"{dummy_answer}\n<metadata>{json.dumps(dummy_meta)}</metadata>"
        return {
            "raw_response": raw_res,
            "answer": dummy_answer,
            "citations": dummy_meta["citations"],
            "confidence": "high"
        }

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = await client.aio.models.generate_content(
            model=settings.GEMINI_REASONING_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.2,
                max_output_tokens=2048,
            )
        )

        if not response.text:
            raise ValueError("Gemini API returned an empty response.")

        raw_response = response.text.strip()
        answer = raw_response
        citations = []
        confidence = "medium"

        if "<metadata>" in raw_response and "</metadata>" in raw_response:
            parts = raw_response.split("<metadata>")
            answer = parts[0].strip()
            meta_json_str = parts[1].split("</metadata>")[0].strip()
            try:
                meta = json.loads(meta_json_str)
                if isinstance(meta, list):
                    citations = meta
                    confidence = "medium"
                else:
                    citations = meta.get("citations", [])
                    confidence = meta.get("confidence", "medium")
            except Exception as e:
                logger.warning("Failed to parse RCA metadata JSON block", error=str(e))

        return {
            "raw_response": raw_response,
            "answer": answer,
            "citations": citations,
            "confidence": confidence
        }

    except Exception as e:
        logger.error("RCA agent generation failed via Gemini API", error=str(e))
        raise e


# ---------------------------------------------------------
# Compile RCA Agent State Graph
# ---------------------------------------------------------
def compile_rca_agent() -> CompiledStateGraph:
    """Builds and compiles the RCA LangGraph workflow state machine."""
    workflow = StateGraph(RCAAgentState)  # type: ignore[arg-type]
    workflow.add_node("load_context", load_failure_context_node)
    workflow.add_node("generate_rca", generate_rca_node)

    workflow.add_edge(START, "load_context")
    workflow.add_edge("load_context", "generate_rca")
    workflow.add_edge("generate_rca", END)

    return workflow.compile()


rca_agent = compile_rca_agent()
