"""PDF escaneado → PDF con texto buscable, con OCRmyPDF + Tesseract en un subproceso con límites."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import signal
import uuid
from pathlib import Path
from typing import ClassVar

import pikepdf
from pydantic import BaseModel

from ..config import Settings
from ..models import OcrStep
from ..problems import Problem
from ..sniff import Kind
from .base import Artifact, StepContext

logger = logging.getLogger(__name__)

# Códigos de salida documentados de OCRmyPDF.
_EXIT_OK = 0
_EXIT_BAD_ARGS = 2
_EXIT_PRIOR_OCR = 6
_EXIT_ENCRYPTED = 8
_EXIT_PDFA_FAILED = 10

_MEMORY_LIMIT_BYTES = 3 * 1024 * 1024 * 1024
_MODE_FLAGS = {"skip-text": "--skip-text", "redo": "--redo-ocr", "force": "--force-ocr"}


def _count_pages(path: Path) -> int:
    try:
        with pikepdf.open(path) as pdf:
            return len(pdf.pages)
    except pikepdf.PasswordError as exc:
        raise Problem(
            422, "pdf.encrypted", "PDF protegido", "Desbloquea el PDF antes de aplicar OCR."
        ) from exc
    except pikepdf.PdfError as exc:
        raise Problem(422, "pdf.corrupt", "PDF dañado", "No se pudo leer el PDF.") from exc


def _kill_group(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return


class OcrTool:
    name: ClassVar[str] = "ocr"
    accepts: ClassVar[frozenset[Kind]] = frozenset({"pdf"})
    produces: ClassVar[Kind] = "pdf"

    def available(self, settings: Settings, ocr_languages: frozenset[str]) -> bool:
        return shutil.which("ocrmypdf") is not None and len(ocr_languages) > 0

    async def run(self, source: Artifact, step: BaseModel, ctx: StepContext) -> Artifact:
        if not isinstance(step, OcrStep):
            raise TypeError("OcrTool recibió un paso que no es OcrStep")
        binary = shutil.which("ocrmypdf")
        if binary is None:
            raise Problem(
                503, "tool.unavailable", "OCR no disponible", "Este servidor no tiene OCR instalado."
            )

        missing = [language for language in step.languages if language not in ctx.ocr_languages]
        if missing:
            raise Problem(
                422, "input.invalid", "Idioma no disponible", f"Idiomas no instalados: {', '.join(missing)}."
            )

        pages = await asyncio.to_thread(_count_pages, source.path)
        if pages > ctx.settings.max_pages:
            raise Problem(
                422,
                "limits.exceeded",
                "Demasiadas páginas",
                f"El PDF tiene {pages} páginas; el máximo es {ctx.settings.max_pages}.",
            )

        output = ctx.workdir / f"ocr-{uuid.uuid4().hex}.pdf"
        command = [
            binary,
            "--output-type",
            "pdfa-2" if step.output == "pdfa-2b" else "pdf",
            "--language",
            "+".join(step.languages),
            _MODE_FLAGS[step.mode],
            "--jobs",
            str(ctx.settings.ocr_threads),
            "--optimize",
            "1",
            "--quiet",
        ]
        if step.deskew:
            command.append("--deskew")
        command += ["--", str(source.path), str(output)]

        # prlimit (util-linux) acota la memoria de cada proceso hijo, Tesseract y Ghostscript incluidos.
        prlimit = shutil.which("prlimit")
        if prlimit is not None:
            command = [prlimit, f"--as={_MEMORY_LIMIT_BYTES}", "--", *command]

        ctx.report(0.1, f"Reconociendo texto en {pages} páginas")
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
            cwd=ctx.workdir,
            env={"PATH": os.environ.get("PATH", ""), "HOME": str(ctx.workdir), "OMP_THREAD_LIMIT": "1"},
        )
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(), timeout=ctx.settings.job_timeout_seconds
            )
        except TimeoutError as exc:
            _kill_group(process)
            await process.wait()
            raise Problem(504, "tool.timeout", "El OCR tardó demasiado") from exc
        except asyncio.CancelledError:
            _kill_group(process)
            await process.wait()
            raise

        code = process.returncode
        if code == _EXIT_PDFA_FAILED and output.exists():
            ctx.warnings.append("No se pudo generar PDF/A válido; se entregó un PDF normal con texto.")
        elif code == _EXIT_PRIOR_OCR:
            raise Problem(
                422, "input.invalid", "El PDF ya tiene texto", "Usa el modo «rehacer» o «forzar» OCR."
            )
        elif code == _EXIT_ENCRYPTED:
            raise Problem(422, "pdf.encrypted", "PDF protegido", "Desbloquea el PDF antes de aplicar OCR.")
        elif code == _EXIT_BAD_ARGS:
            logger.error("ocrmypdf rechazó los argumentos: %s", stderr.decode(errors="replace")[-2000:])
            raise Problem(500, "internal", "Error interno de OCR")
        elif code != _EXIT_OK:
            logger.warning(
                "ocrmypdf terminó con código %s: %s", code, stderr.decode(errors="replace")[-2000:]
            )
            raise Problem(502, "tool.failed", "Falló el OCR", "No se pudo procesar el PDF. ¿Está dañado?")

        ctx.report(1.0, "OCR terminado")
        return Artifact(output, "pdf", "pdf")
