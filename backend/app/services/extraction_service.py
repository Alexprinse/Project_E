import base64
from typing import Any, List, Optional
from google import genai
from google.genai import types
from app.core.config import settings
from app.core.logging import get_logger
from app.models.extraction import ExtractionResult, Equipment, Document, Location, ProcessParameter, Relationship

logger = get_logger(__name__)


def clean_schema(schema: dict) -> dict:
    """Recursively removes 'additionalProperties' from JSON schema dict."""
    if not isinstance(schema, dict):
        return schema
    cleaned: dict[str, Any] = {}
    for k, v in schema.items():
        if k == "additionalProperties":
            continue
        if isinstance(v, dict):
            cleaned[k] = clean_schema(v)
        elif isinstance(v, list):
            cleaned[k] = [clean_schema(item) if isinstance(item, dict) else item for item in v]
        else:
            cleaned[k] = v
    return cleaned


class ExtractionService:
    """Orchestrates structured entity and relationship extraction from files using Gemini 2.5 Pro."""

    def __init__(self):
        # Fallback to mock mode if no api key or mock placeholder is present
        self.is_mock = (
            not settings.GEMINI_API_KEY 
            or settings.GEMINI_API_KEY == "mock-key-for-skeleton"
        )
        if not self.is_mock:
            self.client = genai.Client(api_key=settings.GEMINI_API_KEY)
        else:
            logger.warning(
                "GEMINI_API_KEY is not set. ExtractionService is starting in MOCK mode."
            )

    def chunk_text(self, text: str, chunk_size: int = 20000, overlap: int = 3000) -> List[str]:
        """Splits document text into overlapping segments using a sliding window.

        - Rationale: High density industrial documents contain long specifications.
          A chunk size of 20000 characters (~4000 tokens) respects the 10K TPM limits
          of Voyage AI free tier.
        - Overlap: Ensures relationships bridging split boundaries are not lost.
        """
        if not text:
            return []
        
        chunks = []
        start = 0
        text_len = len(text)
        
        while start < text_len:
            end = min(start + chunk_size, text_len)
            chunks.append(text[start:end])
            if end == text_len:
                break
            start += chunk_size - overlap
            
        logger.info(
            "Document text split into overlapping chunks",
            total_chars=text_len,
            chunks_count=len(chunks),
            chunk_size=chunk_size,
            overlap=overlap
        )
        return chunks

    async def extract_structured_data(
        self,
        text_content: Optional[str] = None,
        image_bytes: Optional[bytes] = None,
        mime_type: Optional[str] = "image/png"
    ) -> ExtractionResult:
        """Invokes Gemini 2.5 Pro model to extract schema entities and relationships.

        Supports text-based content and visual multimodal image inputs (scanned P&IDs/forms).
        """
        if self.is_mock:
            logger.info("Generating mock extraction result (MOCK mode)")
            return self._generate_mock_result(text_content)

        system_instruction = (
            "You are an expert industrial engineering assistant. Your task is to analyze "
            "the provided technical document (operating manual, datasheet, specifications, or diagram) "
            "and extract structured industrial entities and relationships according to the requested schema.\n\n"
            "Key Entities:\n"
            "- Equipment: Extract tags (e.g., P-101A, V-302), machine type, area location, criticality, oem.\n"
            "- Document: Extract document references, versions, dates, authors.\n"
            "- Person: Extract maintenance roles, engineer names, departments, certifications.\n"
            "- Location: Extract units, plants, zones.\n"
            "- ProcessParameter: Extract targets (discharge pressure, flow rate) and their units/ranges.\n\n"
            "Relationships:\n"
            "Establish directed relationships between extracted nodes using standard links: "
            "PART_OF (e.g., Equipment -> Location), HAS_DOCUMENT (e.g., Equipment -> Document), "
            "PERFORMED_ON, PERFORMED_BY, OCCURRED_ON, LINKED_TO, RELATES_TO, APPLIES_TO, GOVERNS.\n\n"
            "Rules:\n"
            "1. Only return relationships where BOTH source and target entities exist in your returned nodes lists.\n"
            "2. Extract Equipment.tag values carefully, matching structural engineering labels (e.g. KV-101)."
        )

        try:
            # Prepare content inputs (multimodal support)
            contents: List[Any] = []
            if text_content:
                contents.append(text_content)
            elif image_bytes:
                # Construct inline data block for GenAI SDK
                contents.append(
                    types.Part.from_bytes(
                        data=image_bytes,
                        mime_type=mime_type or "image/png"
                    )
                )
            else:
                raise ValueError("Must provide either text_content or image_bytes")

            logger.info(
                "Requesting structured extraction from Gemini API",
                model=settings.GEMINI_REASONING_MODEL,
                input_mode="vision" if image_bytes else "text"
            )

            # Get raw Pydantic JSON schema and remove additionalProperties
            raw_schema = ExtractionResult.model_json_schema()
            cleaned_schema = clean_schema(raw_schema)

            # Invoke async client call with retries for rate limits / quota exhaustion
            import asyncio
            for attempt in range(6):
                try:
                    response = await self.client.aio.models.generate_content(
                        model=settings.GEMINI_REASONING_MODEL,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            system_instruction=system_instruction,
                            response_mime_type="application/json",
                            response_schema=cleaned_schema,
                            temperature=0.1,
                        )
                    )

                    # Retrieve Pydantic object
                    if not response.text:
                        raise ValueError("Failed to retrieve valid response text from Gemini response")
                    
                    extraction = ExtractionResult.model_validate_json(response.text)
                    
                    logger.info(
                        "Structured extraction completed",
                        equipments_extracted=len(extraction.equipments),
                        locations_extracted=len(extraction.locations),
                        relationships_extracted=len(extraction.relationships),
                    )
                    return extraction
                except Exception as e:
                    err_msg = str(e).lower()
                    if "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg:
                        wait_sec = 6 + attempt * 4
                        logger.warning(
                            "Gemini API rate limit/quota reached. Sleeping before retry.",
                            attempt=attempt,
                            wait_seconds=wait_sec,
                            error=str(e)
                        )
                        await asyncio.sleep(wait_sec)
                    else:
                        raise e
            raise RuntimeError("Gemini structured extraction failed after maximum retries due to quota exhaustion.")

        except Exception as e:
            logger.error("Failed to perform Gemini structured extraction", error=str(e))
            raise e

    async def describe_image(
        self,
        image_bytes: bytes,
        mime_type: Optional[str] = "image/png"
    ) -> str:
        """Invokes Gemini 2.5 Pro (vision capabilities) to transcribe and describe the diagram or schematic in detail.

        Returns a rich natural language transcription/description of the visual content.
        """
        if self.is_mock:
            logger.info("Generating mock image description (MOCK mode)")
            return "Mock description: P&ID diagram showing centrifugal pump P-101A and vessel V-102 with flow control loop."

        prompt = (
            "Analyze the provided engineering diagram (P&ID, schematic, datasheet, or layout). "
            "Transcribe and describe in detail all information represented: list all equipment tags (e.g. pumps, vessels, valves), "
            "control loops, instrument lines, process lines, safety systems, operational annotations, and parameters. "
            "Create a comprehensive engineering summary that is highly useful for downstream semantic search."
        )

        try:
            contents: List[Any] = [
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type or "image/png"
                ),
                prompt
            ]
            
            import asyncio
            for attempt in range(6):
                try:
                    response = await self.client.aio.models.generate_content(
                        model=settings.GEMINI_REASONING_MODEL,
                        contents=contents,
                    )
                    if not response.text:
                        raise ValueError("Failed to retrieve text description from Gemini response")
                    
                    desc = response.text.strip()
                    logger.info("Structured image description completed", chars_count=len(desc))
                    return desc
                except Exception as e:
                    err_msg = str(e).lower()
                    if "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg:
                        wait_sec = 6 + attempt * 4
                        logger.warning(
                            "Gemini API rate limit/quota reached in image description. Sleeping before retry.",
                            attempt=attempt,
                            wait_seconds=wait_sec,
                            error=str(e)
                        )
                        await asyncio.sleep(wait_sec)
                    else:
                        raise e
            raise RuntimeError("Gemini image description failed after maximum retries due to quota exhaustion.")
        except Exception as e:
            logger.error("Failed to describe image using Gemini vision", error=str(e))
            raise e

    def _generate_mock_result(self, text: Optional[str]) -> ExtractionResult:
        """Generates realistic mock extraction entities to facilitate tests when running offline."""
        import re
        
        # Look for tag patterns (like P-101, V-202) in the text to make mock realistic
        tags = ["P-101", "V-202"]
        if text:
            found = re.findall(r'[A-Z]+-\d+', text)
            if found:
                tags = list(set(found))
        
        equipments = [
            Equipment(
                tag=tag,
                type="Pump" if tag.startswith("P") else "Valve" if tag.startswith("V") else "Equipment",
                location="Refinery Unit 3",
                criticality="High",
                oem="Flowserve"
            ) for tag in tags
        ]
        
        locations = [
            Location(name="Refinery Unit 3", plant="Marg Main Plant", unit="Unit 3")
        ]
        
        doc = Document(
            id="DOC-TEST-01",
            type="Datasheet",
            source_system="Local Upload",
            version="Rev 1"
        )
        
        relationships = [
            Relationship(
                source_id=eq.tag,
                source_label="Equipment",
                target_id="Refinery Unit 3",
                target_label="Location",
                type="PART_OF"
            ) for eq in equipments
        ]
        
        return ExtractionResult(
            equipments=equipments,
            documents=[doc],
            locations=locations,
            relationships=relationships
        )
