from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.db.neo4j_connection import neo4j_service

# Initialize logging before FastAPI startup
setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to Neo4j database
    logger.info("Initializing application startup lifecycles")
    try:
        neo4j_service.connect()
    except Exception as e:
        logger.error("Database connection failure on startup", error=str(e))
        # We continue letting the API run, but it will return degraded states on health check
    
    yield
    
    # Shutdown: Clean up connections
    logger.info("Initializing application shutdown lifecycles")
    neo4j_service.close()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Cross-Origin Resource Sharing (CORS) configurations
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to specific origins (e.g. Next.js host)
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include v1 router
app.include_router(api_router, prefix="/api/v1")


@app.get("/")
def read_root():
    return {
        "message": "Welcome to Project E Industrial Knowledge Intelligence API",
        "docs": "/docs",
        "version": "0.1.0"
    }
