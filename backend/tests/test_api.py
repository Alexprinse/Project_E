from fastapi.testclient import TestClient


def test_root_endpoint(client: TestClient):
    """Ensures root route returns welcoming message."""
    response = client.get("/")
    assert response.status_code == 200
    assert "Welcome" in response.json()["message"]


def test_health_check_endpoint(client: TestClient):
    """Ensures health check indicates database status is ok when mocked successfully."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database_connected"] is True


def test_copilot_query_endpoint(client: TestClient):
    """Ensures RAG queries return expected EventSource stream output."""
    payload = {
        "query": "What are the specs for pipeline A?",
        "conversation_id": "test-session-123"
    }
    response = client.post("/api/v1/copilot/query", json=payload)
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"].lower()
    
    # Verify done event is emitted in the stream
    lines = response.content.decode("utf-8").split("\n")
    assert any(line.startswith("event: done") for line in lines)
