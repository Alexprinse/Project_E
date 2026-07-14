import asyncio
from typing import List, cast
from voyageai.client_async import AsyncClient
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingService:
    """Manages generation of text chunk vector embeddings via Voyage AI."""

    def __init__(self):
        # Allow running in mock mode for local dev/testing if VOYAGE_API_KEY is not set
        self.is_mock = (
            not settings.VOYAGE_API_KEY 
            or settings.VOYAGE_API_KEY == "mock-key-for-skeleton"
        )
        if not self.is_mock:
            self.client = AsyncClient(api_key=settings.VOYAGE_API_KEY)
        else:
            logger.warning(
                "VOYAGE_API_KEY is not set. EmbeddingService is starting in MOCK mode."
            )

    async def get_embeddings(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        """Generates embeddings for a list of text chunks.

        Splits the text chunks into batches and processes them concurrently for maximum throughput.
        """
        if not texts:
            return []

        if self.is_mock:
            logger.info("Generating mock embeddings", count=len(texts), model=settings.VOYAGE_EMBED_MODEL)
            # Voyage-3 default dimension is 1024
            return [[0.01] * 1024 for _ in texts]

        logger.info(
            "Requesting Voyage embeddings",
            chunks_count=len(texts),
            batch_size=batch_size,
            model=settings.VOYAGE_EMBED_MODEL,
        )

        # Batch chunks
        batches = [texts[i:i + batch_size] for i in range(0, len(texts), batch_size)]
        
        async def embed_batch(batch: List[str], idx: int) -> List[List[float]]:
            logger.debug("Embedding batch", batch_index=idx, size=len(batch))
            try:
                response = await self.client.embed(
                    texts=batch,
                    model=settings.VOYAGE_EMBED_MODEL,
                    input_type="document"
                )
                return cast(List[List[float]], response.embeddings)
            except Exception as e:
                logger.error("Failed to generate Voyage embeddings for batch", batch_index=idx, error=str(e))
                raise e

        # Execute batches concurrently
        tasks = [embed_batch(batch, idx) for idx, batch in enumerate(batches)]
        results = await asyncio.gather(*tasks)

        # Flatten list of lists
        all_embeddings = []
        for r in results:
            all_embeddings.extend(r)

        return all_embeddings
