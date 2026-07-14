from typing import Any
from typing_extensions import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from neo4j import Session

from app.core.logging import get_logger
from app.services.rag_service import RAGService

logger = get_logger(__name__)


class AgentState(TypedDict):
    """Represents the graph state variables shared between agent nodes."""
    query: str
    context: dict[str, Any]
    response: str
    messages: list[dict[str, str]]
    session: Session  # Injecting Neo4j session into agent state


async def retrieve_context_node(state: AgentState) -> dict[str, Any]:
    """Node that performs similarity searches & compiles graph context."""
    logger.info("LangGraph Node: Retrieving context", query=state["query"])
    rag_service = RAGService(state["session"])
    context = await rag_service.retrieve_context(state["query"])
    return {"context": context}


async def generate_answer_node(state: AgentState) -> dict[str, Any]:
    """Node that uses retrieved context to formulate answers."""
    logger.info("LangGraph Node: Generating response")
    rag_service = RAGService(state["session"])
    response = await rag_service.generate_response(state["query"], state["context"])
    
    # Append message log
    updated_messages = list(state.get("messages", []))
    updated_messages.append({"role": "user", "content": state["query"]})
    updated_messages.append({"role": "assistant", "content": response})

    return {
        "response": response,
        "messages": updated_messages
    }


def compile_rag_agent() -> CompiledStateGraph:
    """Builds and compiles the StateGraph workflow."""
    workflow = StateGraph(AgentState)  # type: ignore[arg-type]

    # Register nodes
    workflow.add_node("retrieve_context", retrieve_context_node)
    workflow.add_node("generate_answer", generate_answer_node)

    # Set flow sequence
    workflow.add_edge(START, "retrieve_context")
    workflow.add_edge("retrieve_context", "generate_answer")
    workflow.add_edge("generate_answer", END)

    return workflow.compile()


# Compiled agent instance
rag_agent_workflow = compile_rag_agent()
