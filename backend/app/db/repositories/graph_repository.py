import re
from typing import Any, Dict, List
from app.db.repositories.base import BaseRepository
from app.core.logging import get_logger

logger = get_logger(__name__)

def normalize_key(val: str) -> str:
    """Normalizes keys by lowercasing, stripping whitespace, hyphens, and underscores."""
    if not val:
        return ""
    s = val.lower().strip()
    s = re.sub(r'[\-_]', '', s)
    s = re.sub(r'\s+', '', s)
    return s


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

        # Normalize the entity_id if it's one of the standard entities
        original_id = entity_id
        if label in ["Equipment", "Person", "Location", "ProcessParameter", "Regulation"]:
            entity_id = normalize_key(entity_id)
            # Ensure key matches the normalized entity_id
            properties = dict(properties)
            if "display_name" not in properties:
                properties["display_name"] = original_id

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

        if source_label in ["Equipment", "Person", "Location", "ProcessParameter", "Regulation"]:
            source_id = normalize_key(source_id)
        if target_label in ["Equipment", "Person", "Location", "ProcessParameter", "Regulation"]:
            target_id = normalize_key(target_id)

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

    def get_subgraph(self, center_node_id: str, max_depth: int = 2) -> Dict[str, Any]:
        """Retrieves nodes and edges surrounding a particular central node identifier (supports fuzzy lookup)."""
        lower_term = center_node_id.lower().strip()
        
        # 1. Search for all nodes containing the search term case-insensitively.
        # QueryLog is excluded - it's an audit trail, not part of the explorable knowledge graph.
        search_query = """
        MATCH (n)
        WHERE NOT n:QueryLog
          AND (
            (n.id IS NOT NULL AND toLower(n.id) CONTAINS $lower_term) OR
            (n.tag IS NOT NULL AND toLower(n.tag) CONTAINS $lower_term) OR
            (n.name IS NOT NULL AND toLower(n.name) CONTAINS $lower_term) OR
            (n.display_name IS NOT NULL AND toLower(n.display_name) CONTAINS $lower_term) OR
            (n.code IS NOT NULL AND toLower(n.code) CONTAINS $lower_term)
          )
        RETURN n, labels(n) as labels
        LIMIT 100
        """
        search_result = self.session.run(search_query, lower_term=lower_term)
        nodes_list = [(record["n"], record["labels"]) for record in search_result]
        
        resolved_id = center_node_id
        resolved_label = None
        all_matches_meta = []
        
        if nodes_list:
            # 2. Rank nodes using scoring logic
            ranked = []
            for node, labels in nodes_list:
                props = dict(node)
                name = props.get("name", "")
                display = props.get("display_name", "")
                tag = props.get("tag", "")
                code = props.get("code", "")
                node_id = props.get("id", "")
                
                score = 0
                # Exact matches
                for val in [name, display, tag, code, node_id]:
                    if val and val.lower() == lower_term:
                        score += 100
                        break
                
                # Starts with matches
                for val in [name, display, tag, code, node_id]:
                    if val and val.lower().startswith(lower_term):
                        score += 50
                        break
                        
                # Contains matches
                for val in [name, display, tag, code, node_id]:
                    if val and lower_term in val.lower():
                        score += 10
                        break
                
                # Label weights
                if any(l in ["Equipment", "Incident"] for l in labels):
                    score += 30
                elif "Location" in labels:
                    score += 20
                elif "ProcessParameter" in labels:
                    score += 10
                elif any(l in ["Document", "Chunk"] for l in labels):
                    score -= 15
                    
                ranked.append((node, labels, score))
                
            ranked.sort(key=lambda x: x[2], reverse=True)
            
            # Select best node
            best_node, best_labels, best_score = ranked[0]
            best_props = dict(best_node)
            resolved_id = best_props.get("id") or best_props.get("tag") or best_props.get("name") or best_props.get("code") or best_node.element_id
            resolved_label = best_labels[0] if best_labels else None
            
            # Collect matches metadata
            for node, labels, score in ranked:
                props = dict(node)
                nid = props.get("id") or props.get("tag") or props.get("name") or props.get("code") or node.element_id
                display = props.get("display_name") or nid
                all_matches_meta.append({
                    "id": nid,
                    "display_name": display,
                    "labels": labels
                })
        
        # 3. Fetch surrounding subgraph for the resolved center node
        norm_resolved = normalize_key(resolved_id)
        label_clause = f":{resolved_label}" if resolved_label else ""
        
        query = f"""
        MATCH (n{label_clause})
        WHERE n.id = $resolved_id OR n.tag = $resolved_id OR n.name = $resolved_id OR n.code = $resolved_id OR
              n.id = $norm_resolved OR n.tag = $norm_resolved OR n.name = $norm_resolved OR n.code = $norm_resolved
        MATCH path = (n)-[*1..2]-(m)
        RETURN nodes(path) as nodes, relationships(path) as rels
        """
        result = self.session.run(query, resolved_id=resolved_id, norm_resolved=norm_resolved)
        
        nodes_map: Dict[str, Dict[str, Any]] = {}
        relationships_map: Dict[str, Dict[str, Any]] = {}
        
        for record in result:
            for node in record["nodes"]:
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
                relationships_map[rel.element_id] = {
                    "id": rel.element_id,
                    "type": rel.type,
                    "source": src_id,
                    "target": tgt_id,
                    "properties": dict(rel),
                }
                
        # Ensure the resolved center node is in the nodes map even if it has no connections (isolated node)
        if resolved_id and not any(n["id"] == resolved_id for n in nodes_map.values()):
            # Run a quick query to fetch the isolated node properties if needed
            fetch_node_query = f"""
            MATCH (n{label_clause})
            WHERE n.id = $resolved_id OR n.tag = $resolved_id OR n.name = $resolved_id OR n.code = $resolved_id
            RETURN n, labels(n) as labels LIMIT 1
            """
            node_res = self.session.run(fetch_node_query, resolved_id=resolved_id)
            node_rec = node_res.single()
            if node_rec:
                node = node_rec["n"]
                labels = node_rec["labels"]
                nodes_map[node.element_id] = {
                    "id": resolved_id,
                    "labels": list(labels),
                    "properties": dict(node),
                }
                
        return {
            "nodes": list(nodes_map.values()),
            "edges": list(relationships_map.values()),
            "center_node_id": resolved_id,
            "matched_nodes_count": len(all_matches_meta),
            "all_matched_nodes": all_matches_meta
        }

    def delete_document_and_exclusive_entities(self, document_id: str) -> None:
        """Deletes a document node, its chunks, and any physical entities (e.g. Equipment, Locations)
        that become fully isolated (no remaining relationships of any kind) once this document
        and its chunks are removed.

        Entity keys are normalized/deduplicated across documents (see normalize_key), so an entity
        touched by this document may also be shared by other documents or linked to other graph
        structure (e.g. a Location via PART_OF). Such entities must NOT be deleted just because this
        document is gone - only entities left with zero remaining relationships are safe to purge.
        """
        logger.info("Executing garbage-collected document deletion", document_id=document_id)

        query = """
        MATCH (d:Document {id: $document_id})
        OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
        WITH d, collect(c) as chunks
        WITH d, chunks,
             [(d)--(e) WHERE NOT e:Chunk AND NOT e:Document | e] as docEntities,
             reduce(acc = [], ch IN chunks | acc + [(ch)--(e) WHERE NOT e:Chunk AND NOT e:Document | e]) as chunkEntities
        WITH d, chunks, docEntities + chunkEntities as entities
        FOREACH (ch IN chunks | DETACH DELETE ch)
        DETACH DELETE d
        WITH entities
        UNWIND entities as ent
        // Only purge entities left with NO remaining relationships at all (of any type, to any
        // node) after this document and its chunks are gone - not just Document/Chunk links -
        // so entities still referenced by other documents or linked into other graph structure
        // are preserved instead of being silently destroyed.
        OPTIONAL MATCH (ent)-[]-(other)
        WITH ent, count(other) as remaining_connections
        WHERE remaining_connections = 0
        DETACH DELETE ent
        """
        self.session.run(query, document_id=document_id)

