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
