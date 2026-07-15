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

    async def get_embeddings(self, texts: List[str], batch_size: int = 1) -> List[List[float]]:
        """Generates embeddings for a list of text chunks.

        Splits the text chunks into batches and processes them sequentially with a delay
        to strictly respect free tier rate limits (3 RPM / 10K TPM).
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

        # Batch chunks (batch_size=1 enforces single-chunk requests to stay under 10K TPM)
        batches = [texts[i:i + batch_size] for i in range(0, len(texts), batch_size)]
        
        async def embed_batch(batch: List[str], idx: int) -> List[List[float]]:
            import voyageai
            for attempt in range(6):
                try:
                    logger.debug("Embedding batch", batch_index=idx, size=len(batch), attempt=attempt)
                    response = await self.client.embed(
                        texts=batch,
                        model=settings.VOYAGE_EMBED_MODEL,
                        input_type="document"
                    )
                    return cast(List[List[float]], response.embeddings)
                except Exception as e:
                    err_msg = str(e).lower()
                    if "rate limit" in err_msg or "429" in err_msg or "tpm" in err_msg or "rpm" in err_msg:
                        wait_sec = 25 + attempt * 5
                        logger.warning(
                            "Voyage AI Rate limit encountered. Sleeping before retry.",
                            batch_index=idx,
                            attempt=attempt,
                            wait_seconds=wait_sec,
                            error=str(e)
                        )
                        await asyncio.sleep(wait_sec)
                    else:
                        logger.error("Failed to generate Voyage embeddings for batch", batch_index=idx, error=str(e))
                        raise e
            raise RuntimeError(f"Voyage AI embedding generation failed after maximum retries for batch {idx}.")

        # Execute batches sequentially to avoid triggering concurrent rate limits on low RPM tier
        results = []
        for idx, batch in enumerate(batches):
            res = await embed_batch(batch, idx)
            results.append(res)
            # 22 seconds delay between batches to stay under 3 RPM (requests per minute)
            if idx < len(batches) - 1:
                logger.info(f"Sleeping 22 seconds to respect 3 RPM rate limit (batch {idx+1}/{len(batches)})...")
                await asyncio.sleep(22)

        # Flatten list of lists
        all_embeddings = []
        for r in results:
            all_embeddings.extend(r)

        return all_embeddings
