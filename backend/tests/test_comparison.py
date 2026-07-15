import os
import json
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from app.main import app
from app.db.neo4j_connection import neo4j_service

def test_real_comparison_benchmarking():
    """Runs keyword search and Copilot query endpoints against the real database and APIs to measure timing."""
    # 1. Load real environment variables from .env
    load_dotenv()
    
    # Restore actual keys from .env if conftest mocked them
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
    
    # Check if we have active api keys
    gemini_key = os.environ.get("GEMINI_API_KEY")
    voyage_key = os.environ.get("VOYAGE_API_KEY")
    assert gemini_key is not None and gemini_key != "mock-key-for-skeleton", "Real GEMINI_API_KEY must be restored"
    assert voyage_key is not None, "Real VOYAGE_API_KEY is required"
    
    # Overwrite configuration settings properties directly to bypass cached import-time values
    from app.core.config import settings
    original_gemini_key = settings.GEMINI_API_KEY
    original_voyage_key = settings.VOYAGE_API_KEY
    original_overrides = dict(app.dependency_overrides)
    
    settings.GEMINI_API_KEY = gemini_key
    settings.VOYAGE_API_KEY = voyage_key
    
    # 2. Clear FastAPI overrides to use the real Neo4j session generator
    app.dependency_overrides.clear()
    
    # 3. Connect to live Neo4j database
    neo4j_service.connect()
    
    try:
        with TestClient(app) as live_client:
            # Step A: Call traditional keyword search endpoint
            keyword_payload = {"query": "sulfidation corrosion"}
            kw_response = live_client.post("/api/v1/search/keyword", json=keyword_payload)
            assert kw_response.status_code == 200
            kw_data = kw_response.json()
            
            # Verify keyword search results and timing
            assert kw_data["execution_time_sec"] > 0
            assert len(kw_data["results"]) > 0
            # Ensure it found matches from the Chevron report
            has_chevron = any("chevron" in str(r).lower() or "csb" in str(r).lower() for r in kw_data["results"])
            assert has_chevron, "Keyword search did not return matches from the Chevron report"
            
            # Step B: Call Copilot query endpoint (RAG) with retries for transient 503 errors
            import time as pytime
            copilot_payload = {
                "query": "What is the sulfidation corrosion issue on the 4-sidecut piping?",
                "conversation_id": "test-verify-comparison"
            }
            
            done_data = None
            for attempt in range(4):
                co_response = live_client.post("/api/v1/copilot/query", json=copilot_payload)
                assert co_response.status_code == 200
                
                # Parse SSE event stream
                lines = co_response.content.decode("utf-8").split("\n")
                done_event = None
                for line in lines:
                    if line.startswith("data:") and "execution_time_sec" in line:
                        done_event = line[5:].strip()
                        break
                
                if done_event is not None:
                    done_data = json.loads(done_event)
                    break
                
                print(f"\n[WARNING] Copilot query failed to complete (503 spike). Retrying in 3 seconds... (attempt {attempt+1}/4)")
                pytime.sleep(3)
                    
            assert done_data is not None, "Final done event was not found in stream after retries"
            
            # Verify Copilot RAG timing and citations
            assert done_data["execution_time_sec"] > 0
            assert len(done_data["citations"]) > 0
            has_chevron_citation = any(
                any(x in str(cite.get("document_id", "")).lower() or x in str(cite.get("document_name", "")).lower() for x in ["chevron", "richmond", "csb", "2012-03", "etc-sulfidation", "9eaa97"])
                for cite in done_data["citations"]
            )
            assert has_chevron_citation, f"Copilot did not cite the Chevron report. Citations returned: {done_data['citations']}"
            
            print(f"\n[BENCHMARK RESULT] Keyword Search Relevancy Matches: {len(kw_data['results'])}")
            print(f"[BENCHMARK RESULT] Keyword Search Latency: {kw_data['execution_time_sec']:.5f}s")
            print(f"[BENCHMARK RESULT] Copilot RAG Latency: {done_data['execution_time_sec']:.2f}s")
            print(f"[BENCHMARK RESULT] Copilot Grounded Citations: {len(done_data['citations'])}")
            
    finally:
        # Restore configuration settings and dependency overrides to avoid state pollution
        from app.core.config import settings
        settings.GEMINI_API_KEY = original_gemini_key
        settings.VOYAGE_API_KEY = original_voyage_key
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)
        neo4j_service.close()


def test_keyword_exact_matches():
    """Regression test verifying that keyword search returns results for exact literal terms:
    '4-sidecut', 'sulfidation corrosion', and 'rupture disc'.
    """
    load_dotenv()
    
    # Restore original environment if overridden by conftest
    for env_file in [".env", "../.env"]:
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k in ["NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD"]:
                            os.environ[k] = v

    app.dependency_overrides.clear()
    neo4j_service.connect()
    
    try:
        with TestClient(app) as client:
            test_queries = ["4-sidecut", "sulfidation corrosion", "rupture disc"]
            for query in test_queries:
                response = client.post("/api/v1/search/keyword", json={"query": query})
                assert response.status_code == 200
                data = response.json()
                assert len(data["results"]) > 0, f"Keyword search returned 0 results for exact term: {query}"
                print(f"[REGRESSION SUCCESS] Keyword search term '{query}' matched {len(data['results'])} chunks.")
    finally:
        neo4j_service.close()
