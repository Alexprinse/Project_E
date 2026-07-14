import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch


def test_delete_document_endpoint(client: TestClient, mock_neo4j_session: MagicMock):
    """Verifies that the DELETE /api/v1/ingestion/{document_id} route triggers

    database garbage collection and storage removals.
    """
    doc_id = "test-doc-uuid-1234"

    # Patch os.path.exists and os.remove to avoid real disk hits during mock tests
    with patch("os.path.exists", return_value=True), patch("os.remove") as mock_remove:
        response = client.delete(f"/api/v1/ingestion/{doc_id}")

        assert response.status_code == 200
        assert response.json() == {
            "success": True,
            "message": "Document successfully purged from schematic."
        }

        # Assert Neo4j session run was called with the document delete query
        assert mock_neo4j_session.run.call_count >= 1
        last_call_args = mock_neo4j_session.run.call_args[0]
        cypher_statement = last_call_args[0]
        assert "MATCH (d:Document {id: $document_id})" in cypher_statement
        assert "DETACH DELETE ent" in cypher_statement

        # Assert physical file deletion was triggered on disk
        assert mock_remove.call_count == 4
        called_path = mock_remove.call_args[0][0]
        assert doc_id in called_path
