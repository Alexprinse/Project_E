import re
import json
from typing import Any, Dict, List
from neo4j import Session
from app.db.repositories.graph_repository import GraphRepository
from app.db.repositories.vector_repository import VectorRepository
from app.core.config import settings
from app.core.logging import get_logger
from app.services.embedding_service import EmbeddingService

logger = get_logger(__name__)


class RAGService:
    """Orchestrates hybrid Graph-Vector retrieval augmented generation."""

    def __init__(self, session: Session):
        self.session = session
        self.graph_repo = GraphRepository(session)
        self.vector_repo = VectorRepository(session)

    async def classify_query(self, query: str) -> Dict[str, Any]:
        """Determines whether a query is entity-specific or general.

        Uses a fast regex check first, falling back to a quick Gemini Flash query check.
        """
        # First pass: Regex for standard industrial equipment tag formats (e.g. P-101, V-202,
        # PL-01-A, 4-SIDECUT). Real tags always contain at least one digit somewhere in the
        # hyphenated span, whereas ordinary hyphenated English phrases ("follow-up",
        # "state-of-the-art", "on-site") never do - filtering on that avoids misclassifying
        # such phrases as entity tags, which used to short-circuit classify_query before the
        # Gemini out-of-scope check ever ran.
        tag_pattern = r"\b[A-Z0-9]+(?:-[A-Z0-9]+)+\b"
        tags = [t for t in re.findall(tag_pattern, query.upper()) if any(ch.isdigit() for ch in t)]
        if tags:
            logger.info("Regex classifier matched industrial entity tags", tags=tags)
            return {"type": "entity-specific", "entities": list(set(tags))}

        # Fallback pass: Call lightweight Gemini Flash model
        is_mock = settings.is_gemini_mock
        if is_mock:
            return {"type": "general", "entities": []}

        try:
            from google import genai
            from google.genai import types
            
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            
            system_instruction = (
                "Analyze the user query. Classify it into one of these types:\n"
                "1. 'entity-specific': The query references a specific equipment tag (e.g., P-101, V-202), "
                "instrument, location name, or procedure document ID.\n"
                "2. 'structured-filter': The query asks to list, find, or filter items based on structured properties (e.g., 'all equipment with High criticality', 'pumps in Unit 1').\n"
                "3. 'general': A general operational question about engineering, rules, or manual procedures.\n"
                "4. 'out-of-scope': Anything unrelated to plant engineering, safety, operation, or maintenance.\n\n"
                "If type is 'entity-specific', extract any matched tag names or entity names under 'entities' list.\n"
                "If type is 'structured-filter', extract the filter condition as a dict under 'filters' (e.g. {'criticality': 'High'}, {'type': 'Pump'}, {'location': 'Unit 1'}). Only use keys: criticality, type, location, install_date.\n"
                "Return JSON matching: { 'type': 'entity-specific' | 'structured-filter' | 'general' | 'out-of-scope', 'entities': string[], 'filters': dict }"
            )
            
            response = await client.aio.models.generate_content(
                model=settings.GEMINI_LIGHTWEIGHT_MODEL, # gemini-2.5-flash
                contents=query,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    temperature=0.1,
                )
            )
            
            if not response.text:
                raise ValueError("Gemini API returned a response with no text content (possibly blocked or empty).")
                
            data = json.loads(response.text.strip())
            logger.info("Gemini Flash query classification results", data=data)
            return data
            
        except Exception as e:
            logger.warning("Gemini Flash query classification failed, falling back to 'general'", error=str(e))
            return {"type": "general", "entities": []}

    async def retrieve_hybrid_context(self, query: str, limit: int = 15) -> Dict[str, Any]:
        """Retrieves context by running parallel vector similarity searches and relationship graph traversals.

        Scores and fuses result sets, prioritizing direct database relations.
        """
        # 1. Classify query type
        classification = await self.classify_query(query)
        query_type = classification.get("type", "general")
        entities = classification.get("entities", [])
        filters = classification.get("filters", {})

        # 2. Embed query text using Voyage AI
        embed_service = EmbeddingService()
        query_vector_list = await embed_service.get_embeddings([query])
        query_vector = query_vector_list[0] if query_vector_list else [0.01] * 1024

        # 3. Vector Similarity Search
        vector_results = []
        try:
            vector_query = """
            CALL db.index.vector.queryNodes("chunk_embeddings", $limit, $query_vector)
            YIELD node, score
            MATCH (d:Document)-[:HAS_CHUNK]->(node)
            RETURN node.text as text, node.id as chunk_id, d.id as doc_id, d.name as doc_name, score
            """
            res = self.session.run(vector_query, query_vector=query_vector, limit=limit)
            for record in res:
                vector_results.append({
                    "doc_id": record["doc_id"],
                    "doc_name": record["doc_name"],
                    "text": record["text"],
                    "chunk_id": record["chunk_id"],
                    "score": record["score"],
                    "source": "vector"
                })
        except Exception as e:
            logger.error("Vector similarity search execution failed", error=str(e))

        # 4. Graph Traversal (fired only when entity-specific tags are resolved)
        graph_results = []
        graph_facts = []
        if query_type == "entity-specific" and entities:
            logger.info("Executing relational graph traversal", tags=entities)
            from app.db.repositories.graph_repository import normalize_key
            entities_normalized = [normalize_key(e) for e in entities]
            try:
                # Retrieve direct neighbors and follow document constraints
                graph_query = """
                MATCH (e) WHERE e.tag IN $entities OR e.name IN $entities OR e.id IN $entities OR e.code IN $entities
                   OR e.tag IN $entities_normalized OR e.name IN $entities_normalized OR e.code IN $entities_normalized
                MATCH (e)-[r]-(m)
                OPTIONAL MATCH (m)-[:HAS_DOCUMENT|GOVERNS]-(d:Document)
                WITH e, r, m, COALESCE(d, m) as doc_node
                OPTIONAL MATCH (doc_node)-[:HAS_CHUNK]-(c:Chunk)
                RETURN e, r, m, doc_node.id as doc_id, doc_node.name as doc_name, c.text as chunk_text, c.id as chunk_id
                """
                res = self.session.run(graph_query, entities=entities, entities_normalized=entities_normalized)
                for record in res:
                    e_node = record["e"]
                    m_node = record["m"]
                    rel = record["r"]
                    rel_type = rel.type if rel else "UNKNOWN"
                    e_label = list(e_node.labels)[0] if e_node.labels else "Unknown"
                    m_label = list(m_node.labels)[0] if m_node.labels else "Unknown"
                    
                    e_name = e_node.get("tag") or e_node.get("name") or e_node.get("id") or "Unknown"
                    m_name = m_node.get("tag") or m_node.get("name") or m_node.get("id") or "Unknown"
                    
                    fact = f"[{e_label}] {e_name} --({rel_type})--> [{m_label}] {m_name}"
                    graph_facts.append(fact)
                    
                    if record["chunk_text"]:
                        graph_results.append({
                            "doc_id": record["doc_id"],
                            "doc_name": record["doc_name"],
                            "text": record["chunk_text"],
                            "chunk_id": record["chunk_id"],
                            "score": 1.0,  # Exact graph matches bypass score filtering
                            "source": "graph"
                        })
            except Exception as e:
                logger.error("Graph traversal execution failed", error=str(e))
                
        if query_type == "structured-filter" and filters:
            logger.info("Executing structured Cypher filter", filters=filters)
            try:
                where_clauses = []
                params = {}
                for k, v in filters.items():
                    where_clauses.append(f"toLower(e.{k}) CONTAINS toLower(${k})")
                    params[k] = v
                    
                where_string = " AND ".join(where_clauses) if where_clauses else "1=1"
                
                graph_query = f"""
                MATCH (e:Equipment)
                WHERE {where_string}
                OPTIONAL MATCH (e)-[:HAS_DOCUMENT]->(d:Document)-[:HAS_CHUNK]->(c:Chunk)
                WHERE toLower(c.text) CONTAINS toLower(e.tag) OR toLower(c.text) CONTAINS toLower(e.display_name)
                RETURN e, d.id as doc_id, d.name as doc_name, c.text as chunk_text, c.id as chunk_id
                """
                res = self.session.run(graph_query, **params)
                for record in res:
                    e_node = record["e"]
                    
                    props_str = ", ".join([f"{k}={v}" for k,v in e_node.items() if k not in ["created_at", "updated_at"]])
                    graph_facts.append(f"Structured Match: [Equipment] {e_node.get('tag')} has properties: {props_str}")
                    
                    if record["chunk_text"]:
                        graph_results.append({
                            "doc_id": record["doc_id"],
                            "doc_name": record["doc_name"],
                            "text": record["chunk_text"],
                            "chunk_id": record["chunk_id"],
                            "score": 1.0,
                            "source": "structured-filter"
                        })
            except Exception as e:
                logger.error("Structured filter execution failed", error=str(e))

        # 5. Fusion & Ranking Logic
        # Group segments by document ID to deduplicate and establish priority rankings
        fused_docs: dict[Any, dict[str, Any]] = {}
        for item in graph_results + vector_results:
            doc_id = item["doc_id"]
            if doc_id not in fused_docs:
                fused_docs[doc_id] = {
                    "doc_id": doc_id,
                    "doc_name": item["doc_name"],
                    "chunks": [{"chunk_id": item["chunk_id"], "text": item["text"]}],
                    "score": item["score"],
                    "sources": {item["source"]}
                }
            else:
                existing_texts = [c["text"] for c in fused_docs[doc_id]["chunks"]]
                if item["text"] not in existing_texts:
                    fused_docs[doc_id]["chunks"].append({"chunk_id": item["chunk_id"], "text": item["text"]})
                # Apply Max-Score: prioritizing highest retrieval channel score
                fused_docs[doc_id]["score"] = max(fused_docs[doc_id]["score"], item["score"])
                fused_docs[doc_id]["sources"].add(item["source"])

        # Sort documents by score descending
        sorted_docs = sorted(fused_docs.values(), key=lambda x: x["score"], reverse=True)
        top_docs = sorted_docs[:limit]

        logger.info(
            "Hybrid retrieval fusion completed",
            fused_docs_count=len(sorted_docs),
            retained_count=len(top_docs),
            graph_facts_count=len(graph_facts)
        )
        return {
            "query_type": query_type,
            "entities": entities,
            "graph_facts": list(set(graph_facts)),
            "documents": top_docs
        }
