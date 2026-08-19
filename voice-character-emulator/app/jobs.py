"""Async job queue for non-blocking voice generation.

/api/generate returns job_id immediately.
Client polls /api/jobs/<job_id> for status and results.
"""

import asyncio
import logging
import uuid
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class GenerationVariant:
    """Single generated audio variant."""
    audio_url: str
    duration: float  # seconds
    parameters: dict  # temperature, speed, etc. used for this variant


@dataclass
class Job:
    """Voice generation job."""
    id: str
    character: str
    text: str
    language: str
    emotion: str
    status: JobStatus = JobStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    variants: List[GenerationVariant] = field(default_factory=list)  # Best-of-N results
    num_variants: int = 1  # How many to generate

    def to_dict(self):
        return {
            "id": self.id,
            "character": self.character,
            "text": self.text,
            "language": self.language,
            "emotion": self.emotion,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
            "variants": [
                {
                    "audio_url": v.audio_url,
                    "duration": v.duration,
                    "parameters": v.parameters,
                }
                for v in self.variants
            ],
        }


class JobQueue:
    """In-memory job queue. Survives server lifetime."""

    def __init__(self):
        self._jobs = {}  # job_id → Job
        self._lock = asyncio.Lock()

    async def create(
        self,
        character: str,
        text: str,
        language: str,
        emotion: str = "neutral",
        num_variants: int = 1,
    ) -> str:
        """Create new generation job. Returns job_id."""
        job_id = str(uuid.uuid4())
        job = Job(
            id=job_id,
            character=character,
            text=text,
            language=language,
            emotion=emotion,
            num_variants=num_variants,
        )
        async with self._lock:
            self._jobs[job_id] = job
        logger.info(f"📋 Job created: {job_id} ({character}, {language})")
        return job_id

    async def get(self, job_id: str) -> Optional[Job]:
        """Get job by ID."""
        async with self._lock:
            return self._jobs.get(job_id)

    async def mark_processing(self, job_id: str) -> None:
        """Mark job as processing."""
        async with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].status = JobStatus.PROCESSING
                self._jobs[job_id].started_at = datetime.now()

    async def mark_completed(self, job_id: str, variants: List[GenerationVariant]) -> None:
        """Mark job as completed with results."""
        async with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].status = JobStatus.COMPLETED
                self._jobs[job_id].completed_at = datetime.now()
                self._jobs[job_id].variants = variants

    async def mark_failed(self, job_id: str, error: str) -> None:
        """Mark job as failed."""
        async with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].status = JobStatus.FAILED
                self._jobs[job_id].completed_at = datetime.now()
                self._jobs[job_id].error = error

    async def list_recent(self, limit: int = 10):
        """List recent jobs (newest first)."""
        async with self._lock:
            jobs = sorted(
                self._jobs.values(),
                key=lambda j: j.created_at,
                reverse=True,
            )[:limit]
            return [j.to_dict() for j in jobs]


# Global queue (shared across all requests)
_queue = JobQueue()


def get_queue() -> JobQueue:
    """Get job queue singleton."""
    return _queue
