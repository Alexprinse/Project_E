from typing import Generator
from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.neo4j_connection import get_neo4j_session


@pytest.fixture
def mock_neo4j_session() -> MagicMock:
    """Fixture providing a mock Neo4j database session."""
    session = MagicMock()
    
    # Mock result and records for healthcheck / status queries
    mock_result = MagicMock()
    mock_record = MagicMock()
    mock_record.__getitem__.return_value = 1  # For RETURN 1 health check
    mock_record.get.return_value = 1
    mock_record.data.return_value = {"val": 1}
    mock_result.single.return_value = mock_record
    
    session.run.return_value = mock_result
    return session


@pytest.fixture
def client(mock_neo4j_session: MagicMock) -> Generator[TestClient, None, None]:
    """Fixture providing an HTTP client with mocked database dependencies."""
    # Override database session dependency to run tests in isolation
    app.dependency_overrides[get_neo4j_session] = lambda: mock_neo4j_session
    
    with TestClient(app) as test_client:
        yield test_client
        
    # Clean up overrides after test run
    app.dependency_overrides.clear()
