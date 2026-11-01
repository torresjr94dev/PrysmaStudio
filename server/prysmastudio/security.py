from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass

from fastapi import Request

from .config import Settings
from .problems import Problem


def verify_access_key(settings: Settings, provided: str | None) -> None:
    """Instancia privada: solo entra quien tenga una llave. Comparación en tiempo constante."""
    if not settings.requires_access_key:
        return
    if not provided or len(provided) > 256:
        raise Problem(401, "auth.required", "Llave de acceso requerida", "Este servidor es privado.")
    digest = hashlib.sha256(provided.encode()).hexdigest()
    if not any(hmac.compare_digest(digest, expected) for expected in settings.access_key_hashes):
        raise Problem(401, "auth.required", "Llave de acceso inválida")


def client_ip(request: Request, settings: Settings) -> str:
    # Caddy reemplaza el X-Forwarded-For entrante con la IP real: solo se confía en él detrás del proxy.
    if settings.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        candidate = forwarded.rsplit(",", 1)[-1].strip()
        if candidate:
            return candidate[:64]
    return request.client.host if request.client else "unknown"


@dataclass(slots=True)
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    """Token bucket en memoria por IP. Suficiente para un solo nodo; con varios nodos, mover a Valkey."""

    def __init__(self, per_minute: int) -> None:
        self._capacity = float(per_minute)
        self._refill_per_second = per_minute / 60.0
        self._buckets: dict[str, _Bucket] = {}

    def check(self, key: str) -> None:
        now = time.monotonic()
        bucket = self._buckets.get(key)
        if bucket is None:
            bucket = self._buckets[key] = _Bucket(self._capacity, now)
        bucket.tokens = min(self._capacity, bucket.tokens + (now - bucket.updated) * self._refill_per_second)
        bucket.updated = now
        if bucket.tokens < 1:
            retry_after = int((1 - bucket.tokens) / self._refill_per_second) + 1
            raise RateLimited(retry_after)
        bucket.tokens -= 1

    def prune(self, idle_seconds: float = 600) -> None:
        cutoff = time.monotonic() - idle_seconds
        for key in [key for key, bucket in self._buckets.items() if bucket.updated < cutoff]:
            del self._buckets[key]


class RateLimited(Problem):
    def __init__(self, retry_after: int) -> None:
        super().__init__(
            429, "rate.limited", "Demasiadas solicitudes", f"Intenta de nuevo en {retry_after} s."
        )
        self.retry_after = retry_after
