from typing import Generator
from neo4j import GraphDatabase, Driver, Session
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class Neo4jService:
    def __init__(self):
        self._driver: Driver | None = None

    def connect(self) -> None:
        """Initializes the Neo4j Driver pool."""
        try:
            logger.info(
                "Connecting to Neo4j database",
                uri=settings.NEO4J_URI,
                user=settings.NEO4J_USERNAME,
            )
            self._driver = GraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD),
            )
            # Verify connectivity
            self._driver.verify_connectivity()
            logger.info("Successfully connected to Neo4j database")
            self.initialize_schema()
        except Exception as e:
            logger.error("Failed to connect to Neo4j database", error=str(e))
            raise e

    def initialize_schema(self) -> None:
        """Runs the init_schema.cypher file statements on the database."""
        import os
        schema_file = os.path.join(os.path.dirname(__file__), "schema", "init_schema.cypher")
        if not os.path.exists(schema_file):
            logger.warning("Schema initialization file not found", path=schema_file)
            return

        logger.info("Checking/Initializing Neo4j database schema", path=schema_file)
        with open(schema_file, "r") as f:
            content = f.read()

        statements = []
        for stmt in content.split(";"):
            cleaned = []
            for line in stmt.split("\n"):
                line = line.strip()
                if line and not line.startswith("//"):
                    cleaned.append(line)
            stmt_str = " ".join(cleaned).strip()
            if stmt_str:
                statements.append(stmt_str)

        with self.get_session() as session:
            for stmt in statements:
                try:
                    session.run(stmt)
                except Exception as e:
                    # Neo4j raises errors if constraints/indexes already exist in older versions,
                    # we ignore standard already-exists or equivalent errors.
                    err_msg = str(e).lower()
                    if "already exists" in err_msg or "equivalent" in err_msg or "alreadyexist" in err_msg:
                        continue
                    logger.error("Failed to run schema statement", statement=stmt, error=str(e))
        logger.info("Database schema initialization check completed")

    def close(self) -> None:
        """Closes the Neo4j Driver pool."""
        if self._driver:
            logger.info("Closing Neo4j database connection pool")
            self._driver.close()
            self._driver = None

    def get_session(self, database: str | None = None) -> Session:
        """Acquires a new session from the driver pool."""
        if not self._driver:
            raise RuntimeError(
                "Neo4j driver is not initialized. Call connect() first."
            )
        return self._driver.session(database=database)


# Singleton instance
neo4j_service = Neo4jService()


def get_neo4j_session() -> Generator[Session, None, None]:
    """FastAPI Dependency injector that yields a Neo4j session.

    Ensures proper teardown of session after query completion or exception.
    """
    session = neo4j_service.get_session()
    try:
        yield session
    finally:
        session.close()
