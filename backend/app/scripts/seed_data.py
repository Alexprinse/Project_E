import os
import uuid
import shutil
import asyncio
from pathlib import Path
from app.core.config import settings
from app.workers.ingestion_worker import IngestionWorker
from app.db.neo4j_connection import neo4j_service

DATA_GEN_DIR = "/Users/shalem/Documents/Project_E_T/data-gen/output"

async def seed():
    print("Connecting to Neo4j database service...")
    neo4j_service.connect()
    
    print(f"Scanning for sample documents in: {DATA_GEN_DIR}")
    if not os.path.exists(DATA_GEN_DIR):
        print(f"Error: Sample data directory not found at {DATA_GEN_DIR}")
        return

    # Find all .md files
    md_files = []
    for root, _, files in os.walk(DATA_GEN_DIR):
        for f in files:
            if f.endswith(".md") and not f.startswith("."):
                md_files.append(Path(root) / f)

    total = len(md_files)
    print(f"Found {total} sample documents to ingest.")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

    for idx, path in enumerate(md_files, 1):
        job_id = str(uuid.uuid4())
        filename = path.name
        print(f"[{idx}/{total}] Ingesting: {filename}")

        # Copy file to uploads folder
        dest_path = os.path.join(settings.UPLOAD_DIR, f"{job_id}.md")
        shutil.copy(path, dest_path)

        # Start and run ingestion job directly
        try:
            IngestionWorker.start_job(job_id, filename)
            await IngestionWorker.process_document(job_id, dest_path)
            print(f"   -> SUCCESS: Ingested {filename}")
        except Exception as e:
            print(f"   -> FAILED: {filename} - Error: {e}")
        
        # Free-tier rate limit guard (maximum 15 requests per minute)
        await asyncio.sleep(4.2)

    print("Closing Neo4j database connection pool...")
    neo4j_service.close()
    print("\nDatabase seeding completed successfully!")

if __name__ == "__main__":
    asyncio.run(seed())
