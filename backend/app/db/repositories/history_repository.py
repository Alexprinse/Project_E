import json
import uuid
from typing import Any, Dict, List, Optional
from app.db.repositories.base import BaseRepository
from app.core.logging import get_logger

logger = get_logger(__name__)


class HistoryRepository(BaseRepository):
    """Persists a flat, structurally-isolated audit log of past Copilot/RCA query-answer
    exchanges for human traceability.

    QueryLog nodes carry NO relationships to the knowledge graph (Equipment, Document, etc.)
    and are never read by the RAG/RCA retrieval or reasoning paths - this is a human-review
    audit trail only, not a knowledge entity and not conversational memory.
    """

    def log_query(
        self,
        query_type: str,
        query_text: str,
        answer_text: str,
        citations: List[Dict[str, Any]],
        confidence: Optional[str],
        execution_time_sec: Optional[float],
    ) -> Dict[str, Any]:
        """Writes one audit log entry. Citations are stored as a JSON string since Neo4j node
        properties can't hold a list of maps directly."""
        entry_id = str(uuid.uuid4())
        query = """
        CREATE (q:QueryLog {
            id: $id,
            query_type: $query_type,
            query_text: $query_text,
            answer_text: $answer_text,
            citations_json: $citations_json,
            confidence: $confidence,
            execution_time_sec: $execution_time_sec,
            created_at: timestamp()
        })
        RETURN q {.*} as entry
        """
        logger.debug("Logging query/answer to audit history", query_type=query_type, id=entry_id)
        result = self.session.run(
            query,
            id=entry_id,
            query_type=query_type,
            query_text=query_text,
            answer_text=answer_text,
            citations_json=json.dumps(citations or []),
            confidence=confidence,
            execution_time_sec=execution_time_sec,
        )
        record = result.single()
        return self._deserialize(record["entry"]) if record else {}

    def list_recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Returns the most recent audit log entries, newest first."""
        query = """
        MATCH (q:QueryLog)
        RETURN q {.*} as entry
        ORDER BY q.created_at DESC
        LIMIT $limit
        """
        result = self.session.run(query, limit=limit)
        return [self._deserialize(rec["entry"]) for rec in result]

    def delete_entry(self, entry_id: str) -> bool:
        """Deletes a single audit log entry. Returns True if a node was actually deleted."""
        result = self.session.run(
            "MATCH (q:QueryLog {id: $id}) DELETE q", id=entry_id
        )
        summary = result.consume()
        return summary.counters.nodes_deleted > 0

    def delete_all(self) -> int:
        """Deletes every audit log entry. Returns the number of entries removed."""
        result = self.session.run("MATCH (q:QueryLog) DELETE q")
        summary = result.consume()
        return summary.counters.nodes_deleted

    @staticmethod
    def _deserialize(entry: Dict[str, Any]) -> Dict[str, Any]:
        entry = dict(entry)
        raw = entry.pop("citations_json", "[]")
        try:
            entry["citations"] = json.loads(raw) if raw else []
        except Exception:
            entry["citations"] = []
        return entry
