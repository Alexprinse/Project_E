import json
from typing import Any, Dict, List
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.state import CompiledStateGraph
from neo4j import Session
from app.services.rag_service import RAGService
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class CopilotAgentState(TypedDict):
    """LangGraph agent state model for conversational copilot queries."""
    query: str
    conversation_id: str
    history: List[Dict[str, str]]
    query_type: str
    entities: List[str]
    retrieved_context: Dict[str, Any]
    raw_response: str
    answer: str
    citations: List[Dict[str, Any]]
    confidence: str
    session: Session  # Injecting Neo4j session parameter


# ---------------------------------------------------------
# Node 1: Classify Query
# ---------------------------------------------------------
async def classify_query_node(state: CopilotAgentState) -> Dict[str, Any]:
    """Node classifying query intent using regex / Gemini Flash."""
    logger.info("LangGraph Node: Classifying query", query=state["query"])
    rag_service = RAGService(state["session"])
    classification = await rag_service.classify_query(state["query"])
    
    return {
        "query_type": classification.get("type", "general"),
        "entities": classification.get("entities", [])
    }


# ---------------------------------------------------------
# Node 2: Retrieve Context
# ---------------------------------------------------------
async def retrieve_node(state: CopilotAgentState) -> Dict[str, Any]:
    """Node pulling hybrid context (vector similarity + graph traversals)."""
    logger.info("LangGraph Node: Retrieving hybrid context", query_type=state["query_type"])
    rag_service = RAGService(state["session"])
    
    # If out-of-scope, skip retrieval to save latency
    if state["query_type"] == "out-of-scope":
        return {
            "retrieved_context": {
                "query_type": "out-of-scope",
                "entities": [],
                "graph_facts": [],
                "documents": []
            }
        }
        
    context = await rag_service.retrieve_hybrid_context(state["query"])
    return {"retrieved_context": context}


# ---------------------------------------------------------
# Node 3: Generate Answer
# ---------------------------------------------------------
async def generate_answer_node(state: CopilotAgentState) -> Dict[str, Any]:
    """Node invoking Gemini 2.5 Pro reasoning model to formulate answers with inline metadata citations."""
    logger.info("LangGraph Node: Generating answer")
    
    query_type = state["query_type"]
    context = state["retrieved_context"]
    
    if query_type == "out-of-scope":
        ans = (
            "I'm sorry, but that query appears to be out of scope for the Marg "
            "Industrial Knowledge Platform. I can assist you with equipment engineering specs, "
            "refinery units, process parameters, operating manuals, and failure logs."
        )
        metadata = {
            "confidence": "low",
            "citations": []
        }
        raw_res = f"{ans}\n<metadata>{json.dumps(metadata)}</metadata>"
        return {
            "raw_response": raw_res,
            "answer": ans,
            "citations": [],
            "confidence": "low"
        }

    # Format retrieved documents for prompt context
    docs_context = ""
    for d in context.get("documents", []):
        text_segments = "\n---\n".join(d["texts"])
        docs_context += f"Document ID: {d['doc_id']}\nTitle: {d['doc_name']}\nContent:\n{text_segments}\n\n"

    # Format graph relationship facts
    facts_context = "\n".join(context.get("graph_facts", []))

    # Format chat history
    history_str = ""
    for msg in state.get("history", []):
        history_str += f"{msg['role'].capitalize()}: {msg['content']}\n"

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

    User Query: {state['query']}
    """

    is_mock = (
        not settings.GEMINI_API_KEY 
        or settings.GEMINI_API_KEY == "mock-key-for-skeleton"
    )
    
    if is_mock:
        # Generate dummy text matching formatting rules for offline verification
        dummy_answer = (
            f"Based on the plant records for the entities, the centrifugal pump parameters "
            f"align with specifications. Under normal operations, systems are maintained [DOC-TEST-01]."
        )
        dummy_meta = {
            "confidence": "high",
            "citations": [
                {
                    "document_id": "DOC-TEST-01",
                    "document_name": "manual.txt",
                    "snippet": "Normal discharge pressure target parameter is 450 psi."
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
            model=settings.GEMINI_REASONING_MODEL, # gemini-2.5-pro
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.2,
                max_output_tokens=2048,
            )
        )
        
        if not response.text:
            raise ValueError("Gemini API returned a response with no text content (possibly blocked or empty).")
            
        raw_response = response.text.strip()
        
        # Parse answer and metadata out of tags
        answer = raw_response
        citations = []
        confidence = "medium"
        
        if "<metadata>" in raw_response and "</metadata>" in raw_response:
            parts = raw_response.split("<metadata>")
            answer = parts[0].strip()
            meta_json_str = parts[1].split("</metadata>")[0].strip()
            try:
                meta = json.loads(meta_json_str)
                citations = meta.get("citations", [])
                confidence = meta.get("confidence", "medium")
            except Exception as e:
                logger.warning("Failed to parse response metadata json block", error=str(e), block=meta_json_str)
                
        return {
            "raw_response": raw_response,
            "answer": answer,
            "citations": citations,
            "confidence": confidence
        }
        
    except Exception as e:
        logger.error("Failed to generate response using Gemini API", error=str(e))
        raise e


# ---------------------------------------------------------
# Compile LangGraph State Machine
# ---------------------------------------------------------
def compile_copilot_agent() -> CompiledStateGraph:
    """Builds and compiles the conversational Copilot StateGraph."""
    workflow = StateGraph(CopilotAgentState)  # type: ignore[arg-type]
    
    # Register graph nodes
    workflow.add_node("classify_query", classify_query_node)
    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("generate_answer", generate_answer_node)
    
    # Set sequential execution path
    workflow.add_edge(START, "classify_query")
    workflow.add_edge("classify_query", "retrieve")
    workflow.add_edge("retrieve", "generate_answer")
    workflow.add_edge("generate_answer", END)
    
    return workflow.compile()


# Compiled singleton instance
copilot_agent = compile_copilot_agent()
