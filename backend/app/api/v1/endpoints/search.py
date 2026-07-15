import re
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends
from neo4j import Session
from pydantic import BaseModel, Field
from app.db.neo4j_connection import get_neo4j_session
from app.core.logging import get_logger

logger = get_logger(__name__)
router = APIRouter()

# Schema definition for keyword search request/response
class KeywordSearchRequest(BaseModel):
    query: str = Field(..., description="The query keywords to search for")

class KeywordMatch(BaseModel):
    chunk_id: str = Field(..., description="The identifier of the matched chunk")
    text: str = Field(..., description="The matched snippet text")
    score: float = Field(..., description="Search relevancy match score")

class KeywordSearchResponse(BaseModel):
    results: List[KeywordMatch] = Field(default_factory=list, description="Ranked matches")
    execution_time_sec: float = Field(..., description="Actual Cypher execution latency")


STOPWORDS = {
    "what", "is", "the", "for", "to", "of", "in", "on", "at", "a", "an", "and", 
    "or", "but", "if", "then", "else", "pump", "exchanger", "vessel", "valve", 
    "target", "discharge", "pressure", "temperature", "flow", "limit", "value", 
    "spec", "specs", "specification", "specifications", "manual", "record", 
    "records", "document", "documents", "file", "files", "about", "how", "why",
    "where", "when", "who", "which", "are", "do", "does", "did", "have", "has", "had"
}

def preprocess_lucene_query(query: str) -> str:
    words = re.findall(r'[a-zA-Z0-9\-]+', query)
    filtered = []
    for w in words:
        if w.lower() not in STOPWORDS:
            escaped_term = w.replace(":", "\\:").replace("/", "\\/").strip()
            if escaped_term:
                filtered.append(escaped_term)
                
    if not filtered:
        return query.strip()
        
    clauses = []
    for w in filtered:
        clauses.append(f"{w}*")
        clauses.append(f"{w}~")
        if "-" in w:
            squeezed = w.replace("-", "")
            clauses.append(f"{squeezed}*")
            clauses.append(f"{squeezed}~")
            
    return " OR ".join(clauses)


@router.post("/keyword", response_model=KeywordSearchResponse)
async def keyword_search(
    payload: KeywordSearchRequest,
    session: Session = Depends(get_neo4j_session)
) -> Dict[str, Any]:
    """Runs a genuine full-text keyword search across Document properties and Equipment tags.

    Returns the ranked list of raw chunks matching those entities, with execution time.
    """
    logger.info("Received traditional keyword search request", query=payload.query[:40])
    
    start_time = time.time()
    
    query = payload.query
    clean_query = preprocess_lucene_query(query)
    if not clean_query:
        return {"results": [], "execution_time_sec": 0.0}

    # Cypher query 1: Document properties full-text -> Chunks
    doc_cypher = """
    CALL db.index.fulltext.queryNodes("document_properties_fulltext", $query) YIELD node, score
    OPTIONAL MATCH (node)-[:HAS_CHUNK]->(c1:Chunk)
    OPTIONAL MATCH (node)-[*1..2]-(d1:Document)-[:HAS_CHUNK]->(c2:Chunk)
    WITH score, (collect(distinct c1) + collect(distinct c2)) as chunks
    UNWIND chunks as c
    RETURN c.id as chunk_id, c.text as text, score
    LIMIT 20
    """
    
    # Cypher query 2: Equipment tags full-text -> Chunks
    eq_cypher = """
    CALL db.index.fulltext.queryNodes("equipment_tag_fulltext", $query) YIELD node, score
    OPTIONAL MATCH (node)-[:HAS_DOCUMENT|RELATES_TO]-(d:Document)-[:HAS_CHUNK]->(c:Chunk)
    WITH score, collect(distinct c) as chunks
    UNWIND chunks as c
    RETURN c.id as chunk_id, c.text as text, score
    LIMIT 20
    """
    
    results = []
    seen_chunks = set()
    
    try:
        # 1. Search document properties index
        doc_res = session.run(doc_cypher, {"query": clean_query})
        for r in doc_res:
            chunk_id = r["chunk_id"]
            if chunk_id and chunk_id not in seen_chunks:
                seen_chunks.add(chunk_id)
                results.append({
                    "chunk_id": chunk_id,
                    "text": r["text"],
                    "score": float(r["score"])
                })
                
        # 2. Search equipment tags index
        eq_res = session.run(eq_cypher, {"query": clean_query})
        for r in eq_res:
            chunk_id = r["chunk_id"]
            if chunk_id and chunk_id not in seen_chunks:
                seen_chunks.add(chunk_id)
                results.append({
                    "chunk_id": chunk_id,
                    "text": r["text"],
                    "score": float(r["score"])
                })
    except Exception as e:
        logger.error("Keyword search query failed", error=str(e))
        
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    
    # Cap to top 15 results
    results = results[:15]
    
    elapsed = time.time() - start_time
    
    return {
        "results": results,
        "execution_time_sec": elapsed
    }
