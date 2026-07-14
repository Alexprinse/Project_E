from fastapi import APIRouter, Depends, Query
from neo4j import Session
from app.db.neo4j_connection import get_neo4j_session
from app.services.graph_service import GraphService
from app.models.schemas import GraphResponse

router = APIRouter()


@router.get("/explorer", response_model=GraphResponse)
def get_graph_explorer(
    center_node_id: str = Query(..., description="The ID of the central node to query paths from"),
    session: Session = Depends(get_neo4j_session)
) -> GraphResponse:
    """Queries and returns surrounding nodes and relations for a given center node ID."""
    graph_service = GraphService(session)
    subgraph_data = graph_service.fetch_subgraph_explorer(center_node_id)
    
    return GraphResponse(
        nodes=subgraph_data["nodes"],
        edges=subgraph_data["edges"]
    )
