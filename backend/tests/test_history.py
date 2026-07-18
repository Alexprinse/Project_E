import json
import os
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.db.neo4j_connection import neo4j_service


def test_copilot_query_creates_retrievable_history_entry():
    """A completed Copilot query must produce a retrievable /api/v1/history entry with
    matching query text, answer text, and citations - the core audit-trail guarantee.
    """
    # Restore real keys from .env if conftest mocked them, so this hits the live pipeline
    # the same way test_comparison.py / test_rca.py do.
    for env_file in [".env", "../.env"]:
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k in ["GEMINI_API_KEY", "VOYAGE_API_KEY", "NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"]:
                            os.environ[k] = v

    from app.core.config import settings
    original_gemini_key = settings.GEMINI_API_KEY
    settings.GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", original_gemini_key)

    app.dependency_overrides.clear()
    neo4j_service.connect()

    # A distinctive marker so we can unambiguously find this entry among real history data.
    marker = f"history-test-marker-{uuid.uuid4().hex[:8]}"
    query_text = f"What is the sulfidation corrosion issue on the 4-sidecut piping? [{marker}]"
    entry_id = None

    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/copilot/query",
                json={"query": query_text, "conversation_id": f"history-test-{marker}"},
            )
            assert response.status_code == 200

            lines = response.content.decode("utf-8").split("\n")
            done_data = None
            for idx, line in enumerate(lines):
                if line.startswith("event: done"):
                    data_line = lines[idx + 1]
                    if data_line.startswith("data:"):
                        done_data = json.loads(data_line[5:].strip())
            assert done_data is not None, "Copilot query did not complete with a done event"

            # Fetch history and find the entry matching this exact query.
            hist_response = client.get("/api/v1/history?limit=20")
            assert hist_response.status_code == 200
            hist_data = hist_response.json()
            assert "entries" in hist_data

            match = next((e for e in hist_data["entries"] if e["query_text"] == query_text), None)
            assert match is not None, "No history entry found matching the query we just made"

            entry_id = match["id"]
            assert match["answer_text"] == done_data["answer"]
            assert match["query_type"] == "copilot"
            assert match["confidence"] == done_data["confidence"]
            assert len(match["citations"]) == len(done_data["citations"])
            if done_data["citations"]:
                assert match["citations"][0]["document_id"] == done_data["citations"][0]["document_id"]

            # Deletion endpoint removes it.
            del_response = client.delete(f"/api/v1/history/{entry_id}")
            assert del_response.status_code == 200
            assert del_response.json()["success"] is True
            entry_id = None  # already cleaned up

            hist_after = client.get("/api/v1/history?limit=20").json()
            assert not any(e["id"] == match["id"] for e in hist_after["entries"])

    finally:
        # Best-effort cleanup in case an assertion failed before the delete step ran.
        if entry_id:
            try:
                with TestClient(app) as client:
                    client.delete(f"/api/v1/history/{entry_id}")
            except Exception:
                pass
        settings.GEMINI_API_KEY = original_gemini_key
        neo4j_service.close()


def test_clear_all_history_endpoint():
    """DELETE /api/v1/history (no id) removes every entry and reports the deleted count.

    This hits the live shared Neo4j instance, so any real history entries from actual app
    usage are captured beforehand and restored afterward - this test must not permanently
    wipe someone's real audit trail just because the suite ran.
    """
    from app.db.repositories.history_repository import HistoryRepository

    app.dependency_overrides.clear()
    neo4j_service.connect()
    session = neo4j_service.get_session()

    try:
        repo = HistoryRepository(session)
        # Capture pre-existing real entries so they can be restored after this destructive test.
        preexisting = repo.list_recent(limit=200)

        # Seed a couple of throwaway entries directly via the repository.
        repo.log_query(
            query_type="copilot",
            query_text="clear-all-test-query-1",
            answer_text="answer 1",
            citations=[],
            confidence="high",
            execution_time_sec=1.23,
        )
        repo.log_query(
            query_type="rca",
            query_text="clear-all-test-query-2",
            answer_text="answer 2",
            citations=[],
            confidence="medium",
            execution_time_sec=2.34,
        )

        with TestClient(app) as client:
            list_response = client.get("/api/v1/history?limit=200")
            before_count = list_response.json()["count"]
            assert before_count == len(preexisting) + 2

            clear_response = client.delete("/api/v1/history")
            assert clear_response.status_code == 200
            clear_data = clear_response.json()
            assert clear_data["success"] is True
            assert clear_data["deleted_count"] == before_count

            after_response = client.get("/api/v1/history?limit=200")
            assert after_response.json()["count"] == 0
    finally:
        # Restore any real entries that existed before this test ran (new ids/timestamps,
        # but the same content) - content preservation matters more than exact identity here.
        for entry in reversed(preexisting):
            try:
                repo.log_query(
                    query_type=entry.get("query_type", "copilot"),
                    query_text=entry.get("query_text", ""),
                    answer_text=entry.get("answer_text", ""),
                    citations=entry.get("citations", []),
                    confidence=entry.get("confidence"),
                    execution_time_sec=entry.get("execution_time_sec"),
                )
            except Exception:
                pass
        session.close()
        neo4j_service.close()
