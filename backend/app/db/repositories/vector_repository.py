from typing import Any, Dict, List
from app.db.repositories.base import BaseRepository
from app.core.logging import get_logger

logger = get_logger(__name__)


class VectorRepository(BaseRepository):
    """Encapsulates Neo4j Vector Index creation and semantic searches."""

    def create_vector_index(
        self,
        index_name: str,
        label: str,
        property_name: str,
        dimensions: int = 1536,
        similarity_fn: str = "cosine"
    ) -> None:
        """Creates a vector search index on a specific node label and property."""
        query = f"""
        CREATE VECTOR INDEX {index_name} IF NOT EXISTS
        FOR (n:{label}) ON (n.{property_name})
        OPTIONS {{
            indexConfig: {{
                `vector.dimensions`: $dimensions,
                `vector.similarity-function`: $similarity_fn
            }}
        }}
        """
        logger.info(
            "Creating vector index if not exists",
            index=index_name,
            label=label,
            property=property_name,
            dimensions=dimensions,
        )
        self.session.run(query, dimensions=dimensions, similarity_fn=similarity_fn)

    def upsert_node_embedding(
        self,
        label: str,
        node_id: str,
        property_name: str,
        embedding: List[float]
    ) -> None:
        """Attaches an embedding array to a specific node."""
        query = f"""
        MATCH (n:{label} {{id: $node_id}})
        SET n.{property_name} = $embedding, n.embedding_updated_at = timestamp()
        RETURN n.id as node_id
        """
        logger.debug("Upserting embedding for node", label=label, node_id=node_id)
        self.session.run(query, node_id=node_id, embedding=embedding)

    def similarity_search(
        self,
        index_name: str,
        query_vector: List[float],
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """Queries the vector index for nodes matching the query vector."""
        query = f"""
        CALL db.index.vector.queryNodes($index_name, $limit, $query_vector)
        YIELD node, score
        RETURN node {{.*}} as node_properties, labels(node) as node_labels, score
        """
        logger.debug("Executing similarity search on Neo4j vector index", index=index_name, limit=limit)
        result = self.session.run(
            query,
            index_name=index_name,
            query_vector=query_vector,
            limit=limit,
        )
        
        matches = []
        for record in result:
            matches.append({
                "node": record["node_properties"],
                "labels": record["node_labels"],
                "score": record["score"],
            })
        return matches
