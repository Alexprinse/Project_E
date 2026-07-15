import os
from unittest.mock import MagicMock, patch
import pytest
from app.workers.ingestion_worker import IngestionWorker
from app.db.neo4j_connection import neo4j_service


@pytest.mark.asyncio
async def test_full_ingestion_pipeline_success(mock_neo4j_session: MagicMock, tmp_path):
    """Verifies that the document ingestion pipeline handles parsing, structured extraction,

    embeddings, and Neo4j writing successfully.
    """
    # Create a mock text file
    sample_text = (
        "Operating manual for Centrifugal Pump P-101. "
        "The pump is manufactured by Flowserve and is located in Refinery Unit 3. "
        "Normal discharge pressure target parameter is 450 psi."
    )
    test_file = tmp_path / "manual.txt"
    test_file.write_text(sample_text)

    job_id = "test-job-999"

    # We patch neo4j_service.get_session to return our mock session fixture,
    # and patch the Gemini/Voyage API calls so that they run locally without keys.
    with patch.object(neo4j_service, "get_session", return_value=mock_neo4j_session):
        # Trigger background processing
        await IngestionWorker.process_document(job_id=job_id, file_path=str(test_file))

        # Check job completion state in status registry
        job_status = IngestionWorker.get_job_status(job_id)
        assert job_status["status"] == "COMPLETED"
        assert job_status["progress"] == 100
        assert job_status["error"] is None

        # Assert writing nodes to Neo4j was attempted
        # Check that merge_node was called for Document, Equipment, Location, ProcessParameter
        calls = [args[0] for args, _ in mock_neo4j_session.run.call_args_list]
        
        # Verify Document node merge
        assert any("MERGE (n:Document" in call for call in calls)
        # Verify Chunk node merge
        assert any("MERGE (c:Chunk" in call for call in calls)
        # Verify Equipment node merge
        assert any("MERGE (n:Equipment" in call for call in calls)
        # Verify Location node merge
        assert any("MERGE (n:Location" in call for call in calls)
        # Verify Relationship merge
        assert any("MERGE (a)-[r:PART_OF]->(b)" in call for call in calls)


def test_entity_normalization_deduplication():
    """Verifies that GraphRepository normalizes keys and deduplicates variants of the same component tag."""
    from app.db.repositories.graph_repository import GraphRepository
    
    mock_session = MagicMock()
    repo = GraphRepository(mock_session)
    
    # 1. Merge "4-Sidecut Line"
    repo.merge_node("Equipment", "4-Sidecut Line", {"type": "Line"})
    # Assert tag was normalized and display_name is preserved
    calls = mock_session.run.call_args_list
    assert len(calls) == 1
    query = calls[0][0][0]
    params = calls[0][1]
    assert "MERGE (n:Equipment {tag: $entity_id})" in query
    assert params["entity_id"] == "4sidecutline"
    assert params["properties"]["display_name"] == "4-Sidecut Line"
    
    # 2. Merge relationship for "4-sidecut-line" -> "C-1100"
    mock_session.reset_mock()
    repo.merge_relationship(
        source_label="Equipment",
        source_id="4-sidecut-line",
        target_label="Equipment",
        target_id="C-1100",
        rel_type="PART_OF",
        properties={}
    )
    calls = mock_session.run.call_args_list
    assert len(calls) == 1
    params = calls[0][1]
    assert params["source_id"] == "4sidecutline"
    assert params["target_id"] == "c1100"

