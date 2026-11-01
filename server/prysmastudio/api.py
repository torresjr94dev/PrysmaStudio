from __future__ import annotations

import asyncio
import json
import re
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Header, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from .config import Settings
from .jobs import TERMINAL, JobManager, JobStatus, plan_pipeline
from .models import JobSpec
from .problems import Problem
from .security import client_ip, verify_access_key
from .sniff import sniff
from .tools import TOOLS, Artifact

router = APIRouter(prefix="/v1")

_CHUNK = 1024 * 1024
_HEARTBEAT_SECONDS = 15.0
_UNSAFE_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _manager(request: Request) -> JobManager:
    return request.app.state.manager


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def _output_name(declared: str | None) -> str:
    stem = Path(declared or "documento").name.rsplit(".", 1)[0]
    stem = _UNSAFE_NAME.sub("_", stem).strip(" ._") or "documento"
    return f"{stem[:120]}.pdf"


async def _copy_limited(upload: UploadFile, destination: Path, limit: int) -> int:
    written = 0
    with destination.open("wb") as handle:
        while chunk := await upload.read(_CHUNK):
            written += len(chunk)
            if written > limit:
                raise Problem(
                    413,
                    "limits.file_too_large",
                    "Archivo demasiado grande",
                    f"El máximo es {limit // (1024 * 1024)} MB.",
                )
            handle.write(chunk)
    return written


def _first_validation_message(error: ValidationError) -> str:
    first = error.errors()[0] if error.errors() else None
    if first is None:
        return "Especificación inválida."
    location = ".".join(str(part) for part in first.get("loc", ()))
    return f"{location}: {first.get('msg', 'valor inválido')}" if location else str(first.get("msg"))


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/capabilities")
async def capabilities(request: Request) -> dict[str, object]:
    settings = _settings(request)
    manager = _manager(request)
    return {
        "tools": [
            {
                "id": name,
                "available": tool.available(settings, manager.ocr_languages),
                "accepts": sorted(tool.accepts),
            }
            for name, tool in TOOLS.items()
        ],
        "ocrLanguages": sorted(manager.ocr_languages),
        "limits": {"maxUploadBytes": settings.max_upload_bytes, "maxPages": settings.max_pages},
        "requiresAccessKey": settings.requires_access_key,
    }


@router.post("/jobs", status_code=202)
async def create_job(
    request: Request,
    x_access_key: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    settings = _settings(request)
    manager = _manager(request)

    verify_access_key(settings, x_access_key)
    manager.rate_limiter.check(client_ip(request, settings))

    declared_length = request.headers.get("content-length", "")
    if declared_length.isdigit() and int(declared_length) > settings.max_upload_bytes + _CHUNK:
        raise Problem(
            413,
            "limits.file_too_large",
            "Archivo demasiado grande",
            f"El máximo es {settings.max_upload_bytes // _CHUNK} MB.",
        )
    manager.ensure_capacity()

    async with request.form(max_files=1, max_fields=1, max_part_size=64 * 1024) as form:
        spec_raw = form.get("spec")
        upload = form.get("file")
        if not isinstance(spec_raw, str):
            raise Problem(422, "input.invalid", "Falta la especificación", "Envía el campo «spec» con JSON.")
        if not isinstance(upload, UploadFile):
            raise Problem(422, "input.invalid", "Falta el archivo", "Envía el archivo en el campo «file».")
        try:
            spec = JobSpec.model_validate_json(spec_raw)
        except ValidationError as exc:
            raise Problem(
                422, "input.invalid", "Especificación inválida", _first_validation_message(exc)
            ) from exc

        job_id, workdir = manager.new_workdir()
        try:
            source_path = workdir / "input"
            if await _copy_limited(upload, source_path, settings.max_upload_bytes) == 0:
                raise Problem(422, "input.invalid", "Archivo vacío")
            sniffed = await asyncio.to_thread(sniff, source_path, upload.filename or "")
            plan_pipeline(spec, sniffed, settings, manager.ocr_languages)
            output_name = spec.output_name or _output_name(upload.filename)
            job, token = manager.submit(
                job_id, workdir, spec, Artifact(source_path, sniffed.kind, sniffed.extension), output_name
            )
        except BaseException:
            await asyncio.to_thread(shutil.rmtree, workdir, True)
            raise

    return JSONResponse(
        {**job.snapshot(), "jobToken": token},
        status_code=202,
        headers={"Location": f"/v1/jobs/{job.id}"},
    )


@router.get("/jobs/{job_id}")
async def get_job(
    request: Request, job_id: str, authorization: Annotated[str | None, Header()] = None
) -> dict[str, object]:
    return _manager(request).get(job_id, _bearer(authorization)).snapshot()


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    request: Request, job_id: str, authorization: Annotated[str | None, Header()] = None
) -> Response:
    manager = _manager(request)
    await manager.delete(manager.get(job_id, _bearer(authorization)))
    return Response(status_code=204)


_EVENT_NAMES = {
    JobStatus.QUEUED: "job.queued",
    JobStatus.RUNNING: "job.progress",
    JobStatus.COMPLETED: "job.completed",
    JobStatus.FAILED: "job.failed",
    JobStatus.CANCELLED: "job.cancelled",
}


@router.get("/jobs/{job_id}/events")
async def job_events(
    request: Request, job_id: str, authorization: Annotated[str | None, Header()] = None
) -> StreamingResponse:
    job = _manager(request).get(job_id, _bearer(authorization))

    async def stream() -> AsyncIterator[str]:
        seen = -1
        while True:
            if job.version != seen:
                seen = job.version
                payload = json.dumps(job.snapshot(), ensure_ascii=False)
                yield f"id: {seen}\nevent: {_EVENT_NAMES[job.status]}\ndata: {payload}\n\n"
                if job.status in TERMINAL:
                    return
            if not await job.wait_change(seen, _HEARTBEAT_SECONDS):
                yield ": heartbeat\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/result")
async def job_result(
    request: Request, job_id: str, authorization: Annotated[str | None, Header()] = None
) -> FileResponse:
    job = _manager(request).get(job_id, _bearer(authorization))
    if job.status is not JobStatus.COMPLETED or job.result is None:
        raise Problem(409, "job.not_ready", "El resultado aún no está listo")
    return FileResponse(
        job.result,
        media_type="application/pdf",
        filename=job.output_name,
        headers={"Cache-Control": "no-store"},
    )
