from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# Health check Models
class HealthCheckResponse(BaseModel):
    status: str
    database_connected: bool
    version: str = "0.1.0"


# Ingestion Models
class IngestionTriggerResponse(BaseModel):
    job_id: str
    filename: str
    status: str
    message: str


class IngestionStatusResponse(BaseModel):
    id: str
    file_name: str
    status: str
    progress: int
    error: Optional[str] = None


# Copilot / Chat Models
class ChatMessage(BaseModel):
    role: str = Field(..., description="Role of the sender, e.g., 'user' or 'assistant'")
    content: str = Field(..., description="Text content of the message")


class ChatRequest(BaseModel):
    query: str = Field(..., description="The query string to evaluate")
    history: List[ChatMessage] = Field(default=[], description="Previous conversation context")


class RAGContext(BaseModel):
    chunks: List[str]
    graph_entities: List[Dict[str, Any]]


class ChatResponse(BaseModel):
    response: str
    context: RAGContext


# Copilot SSE Models
class CopilotChatRequest(BaseModel):
    query: str = Field(..., description="The user query text")
    conversation_id: Optional[str] = Field(None, description="Optional ID for multi-turn session tracking")


class Citation(BaseModel):
    document_id: str = Field(..., description="ID of source document")
    document_name: str = Field(..., description="File name or title of document")
    snippet: str = Field(..., description="Snippet of text cited from source")


class CopilotChatResponse(BaseModel):
    answer: str = Field(..., description="The synthesized answer from the agent")
    citations: List[Citation] = Field(default_factory=list, description="List of cited source documents")
    confidence: Literal["high", "medium", "low"] = Field("medium", description="Confidence scoring evaluation")
    conversation_id: str = Field(..., description="The session tracking ID")


# Graph Explorer Models
class NodeSchema(BaseModel):
    id: str
    labels: List[str]
    properties: Dict[str, Any]


class EdgeSchema(BaseModel):
    id: str
    type: str
    source: str
    target: str
    properties: Dict[str, Any]


class GraphResponse(BaseModel):
    nodes: List[NodeSchema]
    edges: List[EdgeSchema]
