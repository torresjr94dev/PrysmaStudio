from __future__ import annotations

import hashlib
import io
import json
import time
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from prysmastudio.config import Settings
from prysmastudio.main import create_app

FAKE_PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
ACCESS_KEY = "llave-de-prueba"


def base_settings(work_dir: Path) -> Settings:
    return Settings(
        work_dir=work_dir,
        max_upload_bytes=5 * 1024 * 1024,
        max_pages=300,
        max_concurrent_jobs=2,
        max_pending_jobs=20,
        job_ttl_seconds=3600,
        job_timeout_seconds=30,
        gotenberg_url="http://gotenberg.test",
        access_key_hashes=frozenset(),
        trust_proxy=False,
        jobs_per_minute_per_ip=100,
        ocr_threads=1,
    )


def docx_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", "<w:document/>")
    return buffer.getvalue()


def access_key_hash() -> str:
    return hashlib.sha256(ACCESS_KEY.encode()).hexdigest()


class GotenbergStub:
    """Sustituye a Gotenberg: registra las peticiones y responde lo que el test configure."""

    def __init__(self) -> None:
        self.status = 200
        self.body = FAKE_PDF
        self.requests: list[httpx2.Request] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        assert request.url.path == "/forms/libreoffice/convert"
        return httpx2.Response(self.status, content=self.body)


@pytest.fixture
def gotenberg() -> GotenbergStub:
    return GotenbergStub()


@pytest.fixture
def make_client(tmp_path: Path, gotenberg: GotenbergStub) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        settings = replace(base_settings(tmp_path / f"work{len(clients)}"), **overrides)
        app = create_app(
            settings, http_transport=httpx2.MockTransport(gotenberg.handler), ocr_languages=frozenset()
        )
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


def submit(
    client: TestClient, content: bytes, spec: dict[str, Any], filename: str = "informe.docx", **headers: str
) -> httpx2.Response:
    return client.post(
        "/v1/jobs",
        files={"file": (filename, content, "application/octet-stream")},
        data={"spec": json.dumps(spec)},
        headers=headers,
    )


def wait_terminal(client: TestClient, job_id: str, token: str, timeout: float = 10.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/v1/jobs/{job_id}", headers={"Authorization": f"Bearer {token}"}).json()
        if body["status"] in {"completed", "failed", "cancelled"}:
            return body
        time.sleep(0.05)
    raise AssertionError(f"El job {job_id} no terminó en {timeout} s")


CONVERT = {"steps": [{"tool": "convert"}]}
