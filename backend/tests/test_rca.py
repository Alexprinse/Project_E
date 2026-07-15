import os
import json
import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from app.main import app
from app.db.neo4j_connection import neo4j_service

def test_rca_integration_with_live_db():
    """Runs RCA analysis against the real Chevron sulfidation corrosion Failure node.

    Asserts that:
    1. All 5 sections are populated (or explicitly marked as insufficient data).
    2. At least one citation references the actual Chevron source document.
    3. A confidence level is returned.
    """
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

    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key or gemini_key == "mock-key-for-skeleton":
        pytest.skip("Skipping live database RCA integration test since GEMINI_API_KEY is not set.")

    # Overwrite configuration settings properties directly
    from app.core.config import settings
    original_gemini_key = settings.GEMINI_API_KEY
    settings.GEMINI_API_KEY = gemini_key

    # 2. Clear FastAPI overrides to use the real Neo4j session generator
    app.dependency_overrides.clear()
    
    # 3. Connect to live Neo4j database
    neo4j_service.connect()
    
    try:
        with TestClient(app) as live_client:
            # First, fetch all failures to verify the selector list and get the target failure ID
            res_failures = live_client.get("/api/v1/rca/failures")
            assert res_failures.status_code == 200
            failures_data = res_failures.json()
            assert "failures" in failures_data
            assert len(failures_data["failures"]) > 0

            # Find the Chevron sulfidation failure node. E.g. '2012-08-06-Incident'
            target_id = None
            for fail in failures_data["failures"]:
                if "chevron" in str(fail.get("description", "")).lower() or "sulfidation" in str(fail.get("description", "")).lower():
                    target_id = fail["id"]
                    break

            if not target_id:
                # Fallback to the first available 2012 incident if direct match fails
                for fail in failures_data["failures"]:
                    if "2012" in str(fail["id"]):
                        target_id = fail["id"]
                        break
            
            # If still none, use default '2012-08-06-Incident'
            if not target_id:
                target_id = "2012-08-06-Incident"

            print(f"\n[RCA TEST] Target failure selected: {target_id}")

            # Trigger structured analyze endpoint
            payload = {"failure_id": target_id}
            response = live_client.post("/api/v1/rca/analyze", json=payload)
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"].lower()

            # Parse SSE event stream
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
            assert len(token_events) > 0
            assert done_data is not None
            
            # Verify structured done payload schema
            assert "answer" in done_data
            assert "citations" in done_data
            assert "confidence" in done_data

            answer = done_data["answer"]
            print(f"\n[RCA TEST] Generated RCA Answer Output:\n{answer}\n")

            # Check if all 5 sections are present in the answer
            required_sections = [
                "### Root Cause",
                "### Contributing Factors",
                "### Affected Equipment",
                "### Related Regulations",
                "### Recommended Action"
            ]
            for section in required_sections:
                assert section in answer, f"RCA answer is missing the required section header: {section}"

            # Assert at least one citation references the Chevron source document
            assert len(done_data["citations"]) > 0, "RCA report did not generate any citations."
            has_chevron_citation = any(
                any(x in str(cite.get("document_id", "")).lower() or x in str(cite.get("document_name", "")).lower() for x in ["chevron", "richmond", "csb", "2012-03", "etc-sulfidation", "9eaa97"])
                for cite in done_data["citations"]
            )
            assert has_chevron_citation, f"RCA did not cite the Chevron report. Citations returned: {done_data['citations']}"

            # Assert a confidence level is returned
            assert done_data["confidence"] in ["high", "medium", "low"]

    finally:
        # Restore configuration and clean up
        settings.GEMINI_API_KEY = original_gemini_key
        neo4j_service.close()
