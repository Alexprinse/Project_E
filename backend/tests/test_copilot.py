import json
from fastapi.testclient import TestClient
from unittest.mock import MagicMock


def test_copilot_streaming_integration(client: TestClient, mock_neo4j_session: MagicMock):
    """Integration test verifying that the Copilot API serves SSE data streams,

    incorporates citations, and evaluates confidence scores.
    """
    payload = {
        "query": "What is the normal discharge pressure for Pump P-101?",
        "conversation_id": "integration-test-conv-1"
    }
    
    # Fire query post request to the copilot endpoint
    response = client.post("/api/v1/copilot/query", json=payload)
    
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"].lower()
    
    # Split response stream chunks by line breaks to inspect SSE events
    lines = response.content.decode("utf-8").split("\n")
    
    done_data = None
    status_events = []
    token_events = []
    
    for idx, line in enumerate(lines):
        if line.startswith("event: status"):
            data_line = lines[idx + 1]
            if data_line.startswith("data:"):
                status_events.append(json.loads(data_line[5:].strip()))
        elif line.startswith("event: token"):
            data_line = lines[idx + 1]
            if data_line.startswith("data:"):
                token_events.append(json.loads(data_line[5:].strip()))
        elif line.startswith("event: done"):
            data_line = lines[idx + 1]
            if data_line.startswith("data:"):
                done_data = json.loads(data_line[5:].strip())

    # Assert status milestones were emitted
    assert len(status_events) > 0
    # Assert token fragments were emitted
    assert len(token_events) > 0
    
    # Assert final structured done payload schema
    assert done_data is not None
    assert "answer" in done_data
    assert "citations" in done_data
    assert "confidence" in done_data
    assert done_data["conversation_id"] == "integration-test-conv-1"
    
    # Assert citations point back to our ingested document schemas
    assert len(done_data["citations"]) > 0
    citation = done_data["citations"][0]
    assert citation["document_id"] == "DOC-TEST-01"
    assert "manual.txt" in citation["document_name"]
