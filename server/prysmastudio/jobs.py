"""Gestor de jobs en memoria. Un solo nodo: no hay cola externa. Con más de un nodo, se reintroduce Valkey."""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import logging
import secrets
import shutil
import time
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

import httpx2

from .config import Settings
from .models import JobSpec
from .problems import Problem, internal_problem
from .security import RateLimiter
from .sniff import Sniffed
from .tools import TOOLS, Artifact, StepContext

logger = logging.getLogger(__name__)

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_job_id() -> str:
    """ULID: 48 bits de tiempo + 80 aleatorios en Crockford base32. Ordenable y no adivinable."""
    value = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[value & 31])
        value >>= 5
    return "job_" + "".join(reversed(chars))


def _hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL = frozenset({JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED})


@dataclass(eq=False)
class Job:
    id: str
    token_hash: bytes
    spec: JobSpec
    workdir: Path
    source: Artifact
    output_name: str
    created_at: float
    expires_at: float
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    stage: str = "En cola"
    step: int = 0
    warnings: list[str] = field(default_factory=list)
    error: dict[str, Any] | None = None
    result: Path | None = None
    version: int = 0
    task: asyncio.Task[None] | None = None
    _changed: asyncio.Event = field(default_factory=asyncio.Event)

    def touch(self) -> None:
        self.version += 1
        event, self._changed = self._changed, asyncio.Event()
        event.set()

    async def wait_change(self, seen_version: int, within_seconds: float) -> bool:
        if self.version != seen_version:
            return True
        try:
            async with asyncio.timeout(within_seconds):
                await self._changed.wait()
        except TimeoutError:
            return False
        return True

    def snapshot(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "jobId": self.id,
            "status": self.status.value,
            "step": self.step,
            "stepsTotal": len(self.spec.steps),
            "progress": round(self.progress, 3),
            "stage": self.stage,
            "warnings": list(self.warnings),
            "createdAt": _iso(self.created_at),
            "expiresAt": _iso(self.expires_at),
        }
        if self.error is not None:
            data["error"] = self.error
        return data


def _iso(timestamp: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(timestamp))


def plan_pipeline(spec: JobSpec, sniffed: Sniffed, settings: Settings, ocr_languages: frozenset[str]) -> None:
    """Valida antes de encolar que cada paso acepte lo que produce el anterior y que la herramienta exista."""
    kind = sniffed.kind
    for index, step in enumerate(spec.steps, start=1):
        tool = TOOLS[step.tool]
        if not tool.available(settings, ocr_languages):
            raise Problem(
                503,
                "tool.unavailable",
                "Herramienta no disponible",
                f"El servidor no tiene «{step.tool}» habilitado.",
            )
        if kind not in tool.accepts:
            raise Problem(
                422,
                "pipeline.incompatible",
                "Pasos incompatibles",
                f"El paso {index} («{step.tool}») no acepta archivos de tipo {kind}.",
            )
        kind = tool.produces


class JobManager:
    def __init__(self, settings: Settings, http: httpx2.AsyncClient, ocr_languages: frozenset[str]) -> None:
        self._settings = settings
        self._http = http
        self._ocr_languages = ocr_languages
        self._jobs: dict[str, Job] = {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._sweeper: asyncio.Task[None] | None = None
        self.rate_limiter = RateLimiter(settings.jobs_per_minute_per_ip)

    @property
    def ocr_languages(self) -> frozenset[str]:
        return self._ocr_languages

    async def start(self) -> None:
        self._settings.work_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._sweeper = asyncio.create_task(self._sweep_forever(), name="prysma-sweeper")

    async def stop(self) -> None:
        if self._sweeper:
            self._sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._sweeper
        for job in list(self._jobs.values()):
            await self.delete(job)

    def ensure_capacity(self) -> None:
        pending = sum(1 for job in self._jobs.values() if job.status not in TERMINAL)
        if pending >= self._settings.max_pending_jobs:
            raise Problem(
                503,
                "server.busy",
                "Servidor ocupado",
                "Hay demasiados trabajos en curso. Intenta en unos minutos.",
            )

    def new_workdir(self) -> tuple[str, Path]:
        job_id = new_job_id()
        workdir = self._settings.work_dir / job_id
        workdir.mkdir(mode=0o700)
        return job_id, workdir

    def submit(
        self, job_id: str, workdir: Path, spec: JobSpec, source: Artifact, output_name: str
    ) -> tuple[Job, str]:
        token = secrets.token_urlsafe(32)
        now = time.time()
        job = Job(
            id=job_id,
            token_hash=_hash_token(token),
            spec=spec,
            workdir=workdir,
            source=source,
            output_name=output_name,
            created_at=now,
            expires_at=now + self._settings.job_ttl_seconds,
        )
        self._jobs[job.id] = job
        job.task = asyncio.create_task(self._run(job), name=f"prysma-{job.id}")
        return job, token

    def get(self, job_id: str, token: str | None) -> Job:
        job = self._jobs.get(job_id)
        # Mismo 404 para "no existe" y "token incorrecto": no se revela qué jobs existen.
        if job is None or token is None or not hmac.compare_digest(job.token_hash, _hash_token(token)):
            raise Problem(404, "job.not_found", "Trabajo no encontrado")
        return job

    async def delete(self, job: Job) -> None:
        self._jobs.pop(job.id, None)
        if job.task and not job.task.done():
            job.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await job.task
        await asyncio.to_thread(shutil.rmtree, job.workdir, True)

    async def _run(self, job: Job) -> None:
        def report(progress: float, stage: str) -> None:
            steps = len(job.spec.steps)
            job.progress = min(1.0, ((job.step - 1) + max(0.0, min(1.0, progress))) / steps)
            job.stage = stage
            job.touch()

        try:
            async with self._semaphore:
                job.status = JobStatus.RUNNING
                job.stage = "Procesando"
                job.touch()
                async with asyncio.timeout(self._settings.job_timeout_seconds):
                    artifact = job.source
                    for index, step in enumerate(job.spec.steps, start=1):
                        job.step = index
                        ctx = StepContext(
                            job.workdir, self._settings, self._http, self._ocr_languages, report
                        )
                        artifact = await TOOLS[step.tool].run(artifact, step, ctx)
                        job.warnings.extend(ctx.warnings)
                job.result = artifact.path
                job.status = JobStatus.COMPLETED
                job.progress = 1.0
                job.stage = "Listo"
        except Problem as problem:
            job.status = JobStatus.FAILED
            job.error = problem.to_dict()
        except TimeoutError:
            job.status = JobStatus.FAILED
            job.error = Problem(504, "tool.timeout", "El trabajo tardó demasiado").to_dict()
        except asyncio.CancelledError:
            job.status = JobStatus.CANCELLED
            raise
        except Exception:
            logger.exception("Fallo inesperado en %s", job.id)
            job.status = JobStatus.FAILED
            job.error = internal_problem().to_dict()
        finally:
            job.touch()

    async def _sweep_forever(self) -> None:
        while True:
            await asyncio.sleep(30)
            try:
                now = time.time()
                for job in [job for job in self._jobs.values() if job.expires_at <= now]:
                    await self.delete(job)
                self.rate_limiter.prune()
            except Exception:
                logger.exception("Fallo en la purga de jobs")
