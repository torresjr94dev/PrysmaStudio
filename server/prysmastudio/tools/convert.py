"""Office/OpenDocument → PDF con LibreOffice, aislado en Gotenberg (contenedor sin salida a internet)."""

from __future__ import annotations

import asyncio
import uuid
from typing import ClassVar

import httpx2
from pydantic import BaseModel

from ..config import Settings
from ..problems import Problem
from ..sniff import Kind
from .base import Artifact, StepContext

_MAX_OUTPUT_BYTES = 512 * 1024 * 1024


class ConvertTool:
    name: ClassVar[str] = "convert"
    accepts: ClassVar[frozenset[Kind]] = frozenset({"office"})
    produces: ClassVar[Kind] = "pdf"

    def available(self, settings: Settings, ocr_languages: frozenset[str]) -> bool:
        return settings.gotenberg_url is not None

    async def run(self, source: Artifact, step: BaseModel, ctx: StepContext) -> Artifact:
        base_url = ctx.settings.gotenberg_url
        if base_url is None:
            raise Problem(
                503,
                "tool.unavailable",
                "Conversión no disponible",
                "Este servidor no tiene LibreOffice configurado.",
            )

        ctx.report(0.15, "Convirtiendo con LibreOffice")
        content = await asyncio.to_thread(source.path.read_bytes)
        # Nunca se reenvía el nombre del usuario: Gotenberg solo necesita la extensión real detectada.
        files = {"files": (f"documento.{source.extension}", content, "application/octet-stream")}
        output = ctx.workdir / f"convert-{uuid.uuid4().hex}.pdf"
        timeout = httpx2.Timeout(ctx.settings.job_timeout_seconds, connect=5.0)

        try:
            async with ctx.http.stream(
                "POST", f"{base_url}/forms/libreoffice/convert", files=files, timeout=timeout
            ) as response:
                if response.status_code in (400, 422):
                    raise Problem(
                        422,
                        "input.invalid",
                        "No se pudo convertir",
                        "LibreOffice no pudo abrir el documento. ¿Está dañado o protegido con contraseña?",
                    )
                if response.status_code in (503, 504):
                    raise Problem(504, "tool.timeout", "La conversión tardó demasiado")
                if response.status_code != 200:
                    raise Problem(
                        502,
                        "tool.failed",
                        "Falló la conversión",
                        f"El conversor respondió {response.status_code}.",
                    )

                written = 0
                with output.open("wb") as handle:
                    async for chunk in response.aiter_bytes():
                        written += len(chunk)
                        if written > _MAX_OUTPUT_BYTES:
                            raise Problem(422, "limits.exceeded", "Resultado demasiado grande")
                        handle.write(chunk)
        except httpx2.TimeoutException as exc:
            raise Problem(504, "tool.timeout", "La conversión tardó demasiado") from exc
        except httpx2.TransportError as exc:
            raise Problem(
                503, "tool.unavailable", "Conversión no disponible", "No se pudo contactar al conversor."
            ) from exc

        with output.open("rb") as handle:
            if not handle.read(1024).startswith(b"%PDF-"):
                raise Problem(
                    502,
                    "tool.failed",
                    "Falló la conversión",
                    "El conversor devolvió un archivo que no es PDF.",
                )

        ctx.report(1.0, "Conversión terminada")
        return Artifact(output, "pdf", "pdf")
