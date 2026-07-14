import os
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Project E - Knowledge Intelligence Platform"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    LOG_LEVEL: Literal["debug", "info", "warning", "error"] = "info"

    # Database
    NEO4J_URI: str = Field(default="bolt://localhost:7687")
    NEO4J_USERNAME: str = Field(default="neo4j")
    NEO4J_PASSWORD: str = Field(default="password123")

    # API Keys (required in production, fallback to dummy or optional for skeleton)
    ANTHROPIC_API_KEY: str = Field(default="mock-key-for-skeleton")
    GEMINI_API_KEY: str = Field(default="mock-key-for-skeleton")
    VOYAGE_API_KEY: str = Field(default="mock-key-for-skeleton")

    # Model parameters
    VOYAGE_EMBED_MODEL: str = "voyage-3"
    CLAUDE_REASONING_MODEL: str = "claude-3-5-sonnet-20240620"
    CLAUDE_CLASSIFICATION_MODEL: str = "claude-3-haiku-20240307"
    GEMINI_REASONING_MODEL: str = "gemini-3.1-flash-lite"
    GEMINI_LIGHTWEIGHT_MODEL: str = "gemini-3.1-flash-lite"

    # Worker Settings
    INGESTION_CONCURRENCY: int = 4
    MAX_DOCUMENT_SIZE_MB: int = 50
    UPLOAD_DIR: str = "/tmp/project-e/uploads"

    @property
    def is_dev(self) -> bool:
        return self.ENVIRONMENT == "development"


# Instantiate settings singleton
settings = Settings()

# Ensure directories exist
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
