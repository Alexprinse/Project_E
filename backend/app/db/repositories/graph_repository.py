from typing import Any, Dict, List
from app.db.repositories.base import BaseRepository
from app.core.logging import get_logger

logger = get_logger(__name__)


class GraphRepository(BaseRepository):
    """Encapsulates Neo4j Cypher querying for Graph node/relationship management."""

    def merge_node(self, label: str, entity_id: str, properties: Dict[str, Any]) -> Dict[str, Any]:
        """Creates or updates a node in the graph dynamically matching its unique key field.

        - Equipment uses `tag`
        - Person, Location, ProcessParameter use `name`
        - Regulation uses `code`
        - Other nodes (Document, WorkOrder, Failure, etc.) use `id`
        """
        key_prop = "id"
        if label == "Equipment":
            key_prop = "tag"
        elif label in ["Person", "Location", "ProcessParameter"]:
            key_prop = "name"
        elif label == "Regulation":
            key_prop = "code"

        # Ensure the key property matches entity_id in properties dictionary
        clean_properties = dict(properties)
        clean_properties[key_prop] = entity_id

        query = f"""
        MERGE (n:{label} {{{key_prop}: $entity_id}})
        ON CREATE SET n += $properties, n.created_at = timestamp()
        ON MATCH SET n += $properties, n.updated_at = timestamp()
        RETURN n {{.*}} as node
        """
        logger.debug(
            "Merging node",
            label=label,
            key_prop=key_prop,
            entity_id=entity_id
        )
        result = self.session.run(query, entity_id=entity_id, properties=clean_properties)
        record = result.single()
        return record["node"] if record else {}

    def merge_relationship(
        self,
        source_label: str,
        source_id: str,
        target_label: str,
        target_id: str,
        rel_type: str,
        properties: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Merges a relationship between two nodes resolving their keys dynamically."""
        def get_pk(label: str) -> str:
            if label == "Equipment":
                return "tag"
            elif label in ["Person", "Location", "ProcessParameter"]:
                return "name"
            elif label == "Regulation":
                return "code"
            return "id"

        src_pk = get_pk(source_label)
        tgt_pk = get_pk(target_label)

        query = f"""
        MATCH (a:{source_label} {{{src_pk}: $source_id}})
        MATCH (b:{target_label} {{{tgt_pk}: $target_id}})
        MERGE (a)-[r:{rel_type}]->(b)
        ON CREATE SET r += $properties, r.created_at = timestamp()
        ON MATCH SET r += $properties, r.updated_at = timestamp()
        RETURN r {{.*}} as rel, a.{src_pk} as source, b.{tgt_pk} as target
        """
        logger.debug(
            "Merging relationship dynamically",
            source=f"{source_label}({source_id})",
            target=f"{target_label}({target_id})",
            rel=rel_type
        )
        result = self.session.run(
            query,
            source_id=source_id,
            target_id=target_id,
            properties=properties,
        )
        record = result.single()
        return record.data() if record else {}

    def write_chunk(
        self,
        chunk_id: str,
        doc_id: str,
        text: str,
        index: int,
        embedding: List[float]
    ) -> Dict[str, Any]:
        """Writes a document chunk node, attaches its vector embedding, and links to parent Document."""
        query = """
        MATCH (d:Document {id: $doc_id})
        MERGE (c:Chunk {id: $chunk_id})
        ON CREATE SET c.text = $text, c.index = $index, c.embedding = $embedding, c.created_at = timestamp()
        ON MATCH SET c.text = $text, c.index = $index, c.embedding = $embedding, c.updated_at = timestamp()
        MERGE (d)-[r:HAS_CHUNK]->(c)
        RETURN c { .id, .index } as chunk
        """
        logger.debug("Writing Chunk node and linking to Document", chunk_id=chunk_id, doc_id=doc_id)
        result = self.session.run(
            query,
            doc_id=doc_id,
            chunk_id=chunk_id,
            text=text,
            index=index,
            embedding=embedding
        )
        record = result.single()
        return record["chunk"] if record else {}

    def get_subgraph(self, center_node_id: str, max_depth: int = 2) -> Dict[str, List[Any]]:
        """Retrieves nodes and edges surrounding a particular central node identifier."""
        # Generic match query looking across possible label key fields
        query = """
        MATCH (n) WHERE n.id = $center_node_id OR n.tag = $center_node_id OR n.name = $center_node_id OR n.code = $center_node_id
        MATCH path = (n)-[*1..2]-(m)
        RETURN nodes(path) as nodes, relationships(path) as rels
        """
        result = self.session.run(query, center_node_id=center_node_id)
        
        nodes_map = {}
        relationships = []
        
        for record in result:
            for node in record["nodes"]:
                # Find appropriate display identifier
                node_id = node.get("id") or node.get("tag") or node.get("name") or node.get("code") or node.element_id
                nodes_map[node.element_id] = {
                    "id": node_id,
                    "labels": list(node.labels),
                    "properties": dict(node),
                }
            for rel in record["rels"]:
                src_node = rel.nodes[0]
                tgt_node = rel.nodes[1]
                src_id = src_node.get("id") or src_node.get("tag") or src_node.get("name") or src_node.get("code") or src_node.element_id
                tgt_id = tgt_node.get("id") or tgt_node.get("tag") or tgt_node.get("name") or tgt_node.get("code") or tgt_node.element_id
                relationships.append({
                    "id": rel.element_id,
                    "type": rel.type,
                    "source": src_id,
                    "target": tgt_id,
                    "properties": dict(rel),
                })
                
        return {
            "nodes": list(nodes_map.values()),
            "edges": relationships,
        }

    def delete_document_and_exclusive_entities(self, document_id: str) -> None:
        """Deletes a document node, its chunks, and any physical entities (e.g. Equipment, Locations)
        that were exclusively extracted from it and are no longer connected to any other Document/Chunk.
        """
        logger.info("Executing garbage-collected document deletion", document_id=document_id)
        
        query = """
        MATCH (d:Document {id: $document_id})
        OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
        OPTIONAL MATCH (d)-[r1]-(e1) WHERE NOT e1:Chunk AND NOT e1:Document
        OPTIONAL MATCH (c)-[r2]-(e2) WHERE NOT e2:Chunk AND NOT e2:Document
        WITH d, c, (collect(distinct e1) + collect(distinct e2)) as entities
        DETACH DELETE d, c
        WITH entities
        UNWIND entities as ent
        // Check if the entity is still connected to any other remaining Document or Chunk
        OPTIONAL MATCH (ent)-[]-(other)
        WHERE other:Document OR other:Chunk
        WITH ent, count(other) as remaining_connections
        WHERE remaining_connections = 0
        DETACH DELETE ent
        """
        self.session.run(query, document_id=document_id)

