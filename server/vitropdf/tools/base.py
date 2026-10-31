from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar, Protocol

import httpx2
from pydantic import BaseModel

from ..config import Settings
from ..sniff import Kind


@dataclass(frozen=True, slots=True)
class Artifact:
    """Archivo intermedio de un pipeline: ruta dentro del directorio del job + tipo real detectado."""

    path: Path
    kind: Kind
    extension: str


@dataclass(slots=True)
class StepContext:
    workdir: Path
    settings: Settings
    http: httpx2.AsyncClient
    ocr_languages: frozenset[str]
    report: Callable[[float, str], None]
    warnings: list[str] = field(default_factory=list)


class Tool(Protocol):
    name: ClassVar[str]
    accepts: ClassVar[frozenset[Kind]]
    produces: ClassVar[Kind]

    def available(self, settings: Settings, ocr_languages: frozenset[str]) -> bool: ...

    async def run(self, source: Artifact, step: BaseModel, ctx: StepContext) -> Artifact:
        """Lanza Problem ante fallos esperados. Cualquier otra excepción es un bug (500 + log)."""
        ...
