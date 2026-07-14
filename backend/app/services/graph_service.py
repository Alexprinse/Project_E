from typing import Any, Dict, List
from neo4j import Session
from app.db.repositories.graph_repository import GraphRepository
from app.core.logging import get_logger

logger = get_logger(__name__)


class GraphService:
    """Manages business operations around entity relationship structures in the graph database."""

    def __init__(self, session: Session):
        self.repo = GraphRepository(session)

    def extract_and_merge_entities(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Resolves parsed entities and relations, merging nodes and relationships.

        Prevents duplication of nodes by matching their primary labels and IDs.
        """
        logger.info(
            "Merging entities and relationships into knowledge graph",
            nodes_count=len(nodes),
            edges_count=len(edges),
        )
        
        merged_nodes = []
        for n in nodes:
            node = self.repo.merge_node(
                label=n.get("label", "Entity"),
                entity_id=n["id"],
                properties=n.get("properties", {})
            )
            merged_nodes.append(node)
            
        merged_edges = []
        for e in edges:
            edge = self.repo.merge_relationship(
                source_label=e.get("source_label", "Entity"),
                source_id=e["source_id"],
                target_label=e.get("target_label", "Entity"),
                target_id=e["target_id"],
                rel_type=e["type"],
                properties=e.get("properties", {})
            )
            merged_edges.append(edge)

        return {
            "nodes_inserted": len(merged_nodes),
            "relationships_inserted": len(merged_edges),
        }

    def fetch_subgraph_explorer(self, center_node_id: str) -> Dict[str, Any]:
        """Retrieves nodes and edges for visualizing sections of the graph."""
        logger.debug("Fetching explorer subgraph", center_id=center_node_id)
        return self.repo.get_subgraph(center_node_id)
