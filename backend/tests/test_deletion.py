import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
from app.db.neo4j_connection import neo4j_service
from app.db.repositories.graph_repository import GraphRepository


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


def test_delete_document_preserves_shared_and_linked_entities():
    """Regression test for a data-loss bug: deleting a document used to garbage-collect any
    entity with no OTHER Document/Chunk connection, even if that entity was still shared by
    another document or linked to unrelated graph structure. Reproduces the exact scenario
    (an entity referenced by two documents, and an entity linked only to non-document structure)
    and asserts both survive when one document is deleted, while a truly exclusive entity does not.
    """
    neo4j_service.connect()
    session = neo4j_service.get_session()
    doc_a_id = "test-del-doc-a"
    doc_b_id = "test-del-doc-b"
    shared_tag = "TEST-SHARED-DEL-001"
    exclusive_tag = "TEST-EXCLUSIVE-DEL-001"
    linked_tag = "TEST-LINKED-DEL-001"
    location_name = "TEST-DEL-LOCATION"

    try:
        repo = GraphRepository(session)

        # Two documents.
        repo.merge_node("Document", doc_a_id, {"name": "doc-a.txt", "type": "Text"})
        repo.merge_node("Document", doc_b_id, {"name": "doc-b.txt", "type": "Text"})

        # Entity shared by both documents - must survive deleting doc_a.
        repo.merge_node("Equipment", shared_tag, {"type": "Pump"})
        repo.merge_relationship("Equipment", shared_tag, "Document", doc_a_id, "HAS_DOCUMENT", {})
        repo.merge_relationship("Equipment", shared_tag, "Document", doc_b_id, "HAS_DOCUMENT", {})

        # Entity only ever tied to doc_a - should be garbage collected.
        repo.merge_node("Equipment", exclusive_tag, {"type": "Valve"})
        repo.merge_relationship("Equipment", exclusive_tag, "Document", doc_a_id, "HAS_DOCUMENT", {})

        # Entity tied to doc_a AND to unrelated graph structure (a Location) - must survive,
        # since it still has a remaining relationship after doc_a's edges are removed.
        repo.merge_node("Equipment", linked_tag, {"type": "Sensor"})
        repo.merge_relationship("Equipment", linked_tag, "Document", doc_a_id, "HAS_DOCUMENT", {})
        repo.merge_node("Location", location_name, {"plant": "Test Plant"})
        repo.merge_relationship("Equipment", linked_tag, "Location", location_name, "PART_OF", {})

        # Act: delete doc_a only.
        repo.delete_document_and_exclusive_entities(doc_a_id)

        def node_exists(label: str, key_prop: str, value: str) -> bool:
            from app.db.repositories.graph_repository import normalize_key
            norm = normalize_key(value) if label in ["Equipment", "Person", "Location", "ProcessParameter", "Regulation"] else value
            result = session.run(
                f"MATCH (n:{label} {{{key_prop}: $val}}) RETURN count(n) as cnt", val=norm
            )
            return result.single()["cnt"] > 0

        assert not node_exists("Document", "id", doc_a_id), "doc_a should have been deleted"
        assert node_exists("Document", "id", doc_b_id), "doc_b should NOT have been deleted"
        assert node_exists("Equipment", "tag", shared_tag), (
            "Entity shared with doc_b was incorrectly deleted - this is the data-loss bug."
        )
        assert node_exists("Equipment", "tag", linked_tag), (
            "Entity still linked to a Location was incorrectly deleted - this is the data-loss bug."
        )
        assert not node_exists("Equipment", "tag", exclusive_tag), (
            "Entity exclusive to doc_a should have been garbage collected."
        )

    finally:
        # Cleanup all test fixtures regardless of assertion outcome.
        session.run(
            """
            MATCH (n) WHERE n.id IN [$doc_a, $doc_b] OR n.tag IN [$shared, $exclusive, $linked]
               OR n.name = $location
            DETACH DELETE n
            """,
            doc_a=doc_a_id,
            doc_b=doc_b_id,
            shared=shared_tag.lower().replace("-", ""),
            exclusive=exclusive_tag.lower().replace("-", ""),
            linked=linked_tag.lower().replace("-", ""),
            location=location_name.lower().replace("-", ""),
        )
        session.close()
        neo4j_service.close()
