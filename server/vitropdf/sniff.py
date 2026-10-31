"""Detección del tipo real de archivo por su contenido; nunca por Content-Type ni extensión."""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .problems import Problem

Kind = Literal["pdf", "office"]

_OLE_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")
_ZIP_MAGIC = b"PK\x03\x04"
_LEGACY_OFFICE = {"doc", "xls", "ppt"}
_OPENDOCUMENT = {
    "application/vnd.oasis.opendocument.text": "odt",
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/vnd.oasis.opendocument.presentation": "odp",
}
_OOXML_MARKERS = {
    "word/document.xml": "docx",
    "xl/workbook.xml": "xlsx",
    "ppt/presentation.xml": "pptx",
}

# Límites anti zip-bomb para documentos Office (que son ZIP).
_MAX_ZIP_ENTRIES = 10_000
_MAX_ZIP_UNCOMPRESSED = 512 * 1024 * 1024
_MAX_ENTRY_RATIO = 200


@dataclass(frozen=True, slots=True)
class Sniffed:
    kind: Kind
    extension: str


def _unsupported() -> Problem:
    return Problem(
        415,
        "input.unsupported_type",
        "Tipo de archivo no soportado",
        "Sube un PDF o un documento de Word, Excel, PowerPoint u OpenDocument.",
    )


def _sniff_zip(path: Path) -> Sniffed:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > _MAX_ZIP_ENTRIES:
                raise Problem(
                    422,
                    "limits.exceeded",
                    "Documento sospechoso",
                    "El documento contiene demasiados archivos internos.",
                )
            total = 0
            for entry in entries:
                total += entry.file_size
                ratio = entry.file_size / max(entry.compress_size, 1)
                if total > _MAX_ZIP_UNCOMPRESSED or (
                    entry.file_size > 10 * 1024 * 1024 and ratio > _MAX_ENTRY_RATIO
                ):
                    raise Problem(
                        422,
                        "limits.exceeded",
                        "Documento sospechoso",
                        "El documento se descomprime a un tamaño anómalo.",
                    )

            names = {entry.filename for entry in entries}
            for marker, extension in _OOXML_MARKERS.items():
                if marker in names:
                    return Sniffed("office", extension)
            if "mimetype" in names:
                mimetype = archive.read("mimetype")[:100].decode("ascii", errors="replace").strip()
                if mimetype in _OPENDOCUMENT:
                    return Sniffed("office", _OPENDOCUMENT[mimetype])
    except zipfile.BadZipFile as exc:
        raise _unsupported() from exc
    raise _unsupported()


def sniff(path: Path, declared_name: str) -> Sniffed:
    with path.open("rb") as handle:
        head = handle.read(1024)

    if b"%PDF-" in head:
        return Sniffed("pdf", "pdf")
    if head.startswith(_ZIP_MAGIC):
        return _sniff_zip(path)
    if head.startswith(_OLE_MAGIC):
        # Los formatos binarios antiguos comparten contenedor: aquí sí hace falta la extensión declarada.
        extension = declared_name.rsplit(".", 1)[-1].lower() if "." in declared_name else ""
        if extension in _LEGACY_OFFICE:
            return Sniffed("office", extension)
        raise _unsupported()
    if head.startswith(b"{\\rtf"):
        return Sniffed("office", "rtf")
    raise _unsupported()
