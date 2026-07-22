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


class IngestionJobResponse(IngestionStatusResponse):
    created_at: Optional[int] = None
    updated_at: Optional[int] = None


class IngestionJobsResponse(BaseModel):
    jobs: List[IngestionJobResponse] = Field(default_factory=list)


class StatsOverviewResponse(BaseModel):
    document_count: int = 0
    entity_count: int = 0
    chunk_count: int = 0
    failure_count: int = 0
    active_ingestion_jobs: int = 0
    completed_ingestion_jobs: int = 0
    failed_ingestion_jobs: int = 0
    database_connected: bool = False
    vector_index_state: Optional[str] = None
    recent_jobs: List[IngestionJobResponse] = Field(default_factory=list)


# Copilot / Chat Models
class ChatMessage(BaseModel):
    role: str = Field(
        ..., description="Role of the sender, e.g., 'user' or 'assistant'"
    )
    content: str = Field(..., description="Text content of the message")


class ChatRequest(BaseModel):
    query: str = Field(..., description="The query string to evaluate")
    history: List[ChatMessage] = Field(
        default=[], description="Previous conversation context"
    )


class RAGContext(BaseModel):
    chunks: List[str]
    graph_entities: List[Dict[str, Any]]


class ChatResponse(BaseModel):
    response: str
    context: RAGContext


# Copilot SSE Models
class CopilotChatRequest(BaseModel):
    query: str = Field(..., description="The user query text")
    conversation_id: Optional[str] = Field(
        None, description="Optional ID for multi-turn session tracking"
    )
    query_type: Literal["copilot", "keyword-comparison"] = Field(
        "copilot",
        description="Which feature surface triggered this query, for audit history tagging. "
        "'keyword-comparison' is used when the query was run from the Copilot's side-by-side "
        "benchmark view against keyword search.",
    )


class Citation(BaseModel):
    chunk_id: Optional[str] = Field(None, description="Optional ID of specific cited chunk")
    document_id: str = Field(..., description="ID of source document")
    document_name: str = Field(..., description="File name or title of document")
    snippet: str = Field(..., description="Snippet of text cited from source")


class CopilotChatResponse(BaseModel):
    answer: str = Field(..., description="The synthesized answer from the agent")
    citations: List[Citation] = Field(
        default_factory=list, description="List of cited source documents"
    )
    confidence: Literal["high", "medium", "low"] = Field(
        "medium", description="Confidence scoring evaluation"
    )
    conversation_id: str = Field(..., description="The session tracking ID")


# Query History / Audit Trail Models
class HistoryEntryResponse(BaseModel):
    id: str
    query_type: str = Field(..., description="Feature that generated this entry: copilot, rca, or keyword-comparison")
    query_text: str
    answer_text: str
    citations: List[Citation] = Field(default_factory=list)
    confidence: Optional[Literal["high", "medium", "low"]] = None
    execution_time_sec: Optional[float] = None
    created_at: Optional[int] = None


class HistoryListResponse(BaseModel):
    entries: List[HistoryEntryResponse] = Field(default_factory=list)
    count: int = 0


class HistoryDeleteResponse(BaseModel):
    success: bool = True
    deleted_count: int = 0


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
    center_node_id: Optional[str] = None
    matched_nodes_count: Optional[int] = None
    all_matched_nodes: Optional[List[Dict[str, Any]]] = None
