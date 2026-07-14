from neo4j import Session


class BaseRepository:
    """Base repository class providing unified access to Neo4j Sessions."""

    def __init__(self, session: Session):
        self.session = session
