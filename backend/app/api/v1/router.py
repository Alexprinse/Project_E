from fastapi import APIRouter
from app.api.v1.endpoints import health, ingestion, copilot, graph, search, rca

api_router = APIRouter()

api_router.include_router(health.router, prefix="/health", tags=["Health"])
api_router.include_router(ingestion.router, prefix="/ingestion", tags=["Ingestion"])
api_router.include_router(copilot.router, prefix="/copilot", tags=["Copilot"])
api_router.include_router(graph.router, prefix="/graph", tags=["Graph Explorer"])
api_router.include_router(search.router, prefix="/search", tags=["Search"])
api_router.include_router(rca.router, prefix="/rca", tags=["RCA Assistant"])

