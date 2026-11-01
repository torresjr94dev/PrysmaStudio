from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")


class ConfigError(ValueError):
    """Configuración inválida: el servidor no arranca en lugar de funcionar a medias."""


def _int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "").strip()
    if raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} debe ser un entero, se recibió {raw!r}") from exc
    if not minimum <= value <= maximum:
        raise ConfigError(f"{name} debe estar entre {minimum} y {maximum}, se recibió {value}")
    return value


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if raw == "":
        return default
    if raw in {"1", "true", "yes"}:
        return True
    if raw in {"0", "false", "no"}:
        return False
    raise ConfigError(f"{name} debe ser true o false, se recibió {raw!r}")


def _access_key_hashes() -> frozenset[str]:
    raw = os.environ.get("PRYSMA_ACCESS_KEYS_SHA256", "").strip()
    if raw == "":
        return frozenset()
    hashes = {item.strip().lower() for item in raw.split(",") if item.strip()}
    invalid = [item for item in hashes if not _SHA256_HEX.match(item)]
    if invalid:
        raise ConfigError(
            "PRYSMA_ACCESS_KEYS_SHA256 debe contener hashes SHA-256 en hexadecimal separados por comas"
        )
    return frozenset(hashes)


@dataclass(frozen=True, slots=True)
class Settings:
    work_dir: Path
    max_upload_bytes: int
    max_pages: int
    max_concurrent_jobs: int
    max_pending_jobs: int
    job_ttl_seconds: int
    job_timeout_seconds: int
    gotenberg_url: str | None
    access_key_hashes: frozenset[str]
    trust_proxy: bool
    jobs_per_minute_per_ip: int
    ocr_threads: int

    @property
    def requires_access_key(self) -> bool:
        return len(self.access_key_hashes) > 0

    @classmethod
    def from_env(cls) -> Settings:
        gotenberg = os.environ.get("PRYSMA_GOTENBERG_URL", "").strip().rstrip("/")
        if gotenberg and not re.match(r"^https?://[A-Za-z0-9.\-]+(:\d{1,5})?$", gotenberg):
            raise ConfigError("PRYSMA_GOTENBERG_URL debe ser una URL http(s)://host[:puerto] sin ruta")

        work_dir = Path(os.environ.get("PRYSMA_WORK_DIR", "/work"))
        return cls(
            work_dir=work_dir,
            max_upload_bytes=_int("PRYSMA_MAX_UPLOAD_MB", 100, 1, 2048) * 1024 * 1024,
            max_pages=_int("PRYSMA_MAX_PAGES", 300, 1, 10_000),
            max_concurrent_jobs=_int("PRYSMA_MAX_CONCURRENT_JOBS", 2, 1, 64),
            max_pending_jobs=_int("PRYSMA_MAX_PENDING_JOBS", 20, 1, 1000),
            job_ttl_seconds=_int("PRYSMA_JOB_TTL_SECONDS", 3600, 60, 86_400),
            job_timeout_seconds=_int("PRYSMA_JOB_TIMEOUT_SECONDS", 600, 10, 7200),
            gotenberg_url=gotenberg or None,
            access_key_hashes=_access_key_hashes(),
            trust_proxy=_bool("PRYSMA_TRUST_PROXY", False),
            jobs_per_minute_per_ip=_int("PRYSMA_JOBS_PER_MINUTE_PER_IP", 10, 1, 10_000),
            ocr_threads=_int("PRYSMA_OCR_THREADS", 2, 1, 64),
        )
