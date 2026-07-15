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
        # First pass: Regex for standard industrial equipment tag formats (e.g. P-101, V-202, PL-01-A)
        tag_pattern = r"\b[A-Z0-9]+-[0-9A-Z\-]+\b"
        tags = re.findall(tag_pattern, query.upper())
        if tags:
            logger.info("Regex classifier matched industrial entity tags", tags=tags)
            return {"type": "entity-specific", "entities": list(set(tags))}

        # Fallback pass: Call lightweight Gemini Flash model
        is_mock = (
            not settings.GEMINI_API_KEY 
            or settings.GEMINI_API_KEY == "mock-key-for-skeleton"
        )
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
                "2. 'general': A general operational question about engineering, rules, or manual procedures.\n"
                "3. 'out-of-scope': Anything unrelated to plant engineering, safety, operation, or maintenance.\n\n"
                "Extract any matched tag names or entity names under 'entities' list.\n"
                "Return JSON matching: { 'type': 'entity-specific' | 'general' | 'out-of-scope', 'entities': string[] }"
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

    async def retrieve_hybrid_context(self, query: str, limit: int = 3) -> Dict[str, Any]:
        """Retrieves context by running parallel vector similarity searches and relationship graph traversals.

        Scores and fuses result sets, prioritizing direct database relations.
        """
        # 1. Classify query type
        classification = await self.classify_query(query)
        query_type = classification.get("type", "general")
        entities = classification.get("entities", [])

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
                    e_props = dict(record["e"])
                    m_props = dict(record["m"])
                    r_type = record["r"].type
                    
                    e_label = list(record["e"].labels)[0] if record["e"].labels else "Entity"
                    m_label = list(record["m"].labels)[0] if record["m"].labels else "Entity"
                    
                    # Log structured graph fact string
                    src_val = e_props.get("tag") or e_props.get("name")
                    tgt_val = m_props.get("tag") or m_props.get("name") or m_props.get("id")
                    fact_str = f"({e_label}: {src_val}) -[{r_type}]-> ({m_label}: {tgt_val})"
                    graph_facts.append(fact_str)

                    # Extract context document if linked
                    doc_id = record["doc_id"]
                    doc_name = record["doc_name"]
                    chunk_text = record["chunk_text"]
                    chunk_id = record["chunk_id"]
                    
                    if doc_id and doc_name and chunk_text:
                        graph_results.append({
                            "doc_id": doc_id,
                            "doc_name": doc_name,
                            "text": chunk_text,
                            "chunk_id": chunk_id,
                            # Boost direct graph relationships to maximum relevance
                            "score": 1.0, 
                            "source": "graph"
                        })
            except Exception as e:
                logger.error("Graph traversal execution failed", error=str(e))

        # 5. Fusion & Ranking Logic
        # Group segments by document ID to deduplicate and establish priority rankings
        fused_docs: dict[Any, dict[str, Any]] = {}
        for item in graph_results + vector_results:
            doc_id = item["doc_id"]
            if doc_id not in fused_docs:
                fused_docs[doc_id] = {
                    "doc_id": doc_id,
                    "doc_name": item["doc_name"],
                    "texts": [item["text"]],
                    "score": item["score"],
                    "sources": {item["source"]}
                }
            else:
                if item["text"] not in fused_docs[doc_id]["texts"]:
                    fused_docs[doc_id]["texts"].append(item["text"])
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
