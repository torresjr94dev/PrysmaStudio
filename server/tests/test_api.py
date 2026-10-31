from __future__ import annotations

import io
import json
import shutil
import zipfile
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import (
    ACCESS_KEY,
    CONVERT,
    GotenbergStub,
    access_key_hash,
    docx_bytes,
    submit,
    wait_terminal,
)

ClientFactory = Callable[..., TestClient]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_capabilities(make_client: ClientFactory) -> None:
    body = make_client().get("/v1/capabilities").json()
    tools = {tool["id"]: tool["available"] for tool in body["tools"]}
    assert tools == {"convert": True, "ocr": False}
    assert body["requiresAccessKey"] is False


def test_convert_end_to_end(make_client: ClientFactory, gotenberg: GotenbergStub) -> None:
    client = make_client()
    response = submit(client, docx_bytes(), CONVERT, filename="Informe Anual.docx")
    assert response.status_code == 202, response.text
    created = response.json()
    assert created["jobId"].startswith("job_") and len(created["jobId"]) == 30
    assert response.headers["location"] == f"/v1/jobs/{created['jobId']}"

    final = wait_terminal(client, created["jobId"], created["jobToken"])
    assert final["status"] == "completed", final

    result = client.get(f"/v1/jobs/{created['jobId']}/result", headers=auth(created["jobToken"]))
    assert result.status_code == 200
    assert result.content.startswith(b"%PDF-")
    assert result.headers["content-disposition"] == "attachment; filename*=utf-8''Informe%20Anual.pdf"
    assert result.headers["cache-control"] == "no-store"

    # Gotenberg nunca recibe el nombre original del usuario.
    sent = gotenberg.requests[0].content
    assert b'filename="documento.docx"' in sent
    assert b"Informe Anual" not in sent


def test_events_stream_until_completion(make_client: ClientFactory) -> None:
    client = make_client()
    created = submit(client, docx_bytes(), CONVERT).json()
    events: list[str] = []
    with client.stream(
        "GET", f"/v1/jobs/{created['jobId']}/events", headers=auth(created["jobToken"])
    ) as stream:
        assert stream.headers["content-type"].startswith("text/event-stream")
        for line in stream.iter_lines():
            if line.startswith("event: "):
                events.append(line.removeprefix("event: "))
    assert events[-1] == "job.completed"


def test_wrong_token_is_indistinguishable_from_missing_job(make_client: ClientFactory) -> None:
    client = make_client()
    created = submit(client, docx_bytes(), CONVERT).json()
    wrong = client.get(f"/v1/jobs/{created['jobId']}", headers=auth("otro-token"))
    missing = client.get("/v1/jobs/job_00000000000000000000000000", headers=auth(created["jobToken"]))
    assert wrong.status_code == missing.status_code == 404
    assert wrong.headers["content-type"] == "application/problem+json"
    assert wrong.json()["code"] == missing.json()["code"] == "job.not_found"


def test_delete_purges_job_and_files(make_client: ClientFactory, tmp_path: Path) -> None:
    client = make_client()
    created = submit(client, docx_bytes(), CONVERT).json()
    wait_terminal(client, created["jobId"], created["jobToken"])
    workdir = tmp_path / "work0" / created["jobId"]
    assert workdir.exists()

    assert client.delete(f"/v1/jobs/{created['jobId']}", headers=auth(created["jobToken"])).status_code == 204
    assert not workdir.exists()
    assert client.get(f"/v1/jobs/{created['jobId']}", headers=auth(created["jobToken"])).status_code == 404


def test_rejects_unsupported_content_regardless_of_extension(make_client: ClientFactory) -> None:
    response = submit(make_client(), b"esto no es un documento", CONVERT, filename="truco.docx")
    assert response.status_code == 415
    assert response.json()["code"] == "input.unsupported_type"


@pytest.mark.parametrize(
    "spec",
    [
        {"steps": [{"tool": "convert", "extra": True}]},
        {"steps": []},
        {"steps": [{"tool": "borrar-todo"}]},
        {"steps": [{"tool": "convert"}], "outputName": "../../etc/passwd"},
    ],
)
def test_rejects_invalid_specs(make_client: ClientFactory, spec: dict[str, object]) -> None:
    response = submit(make_client(), docx_bytes(), spec)
    assert response.status_code == 422
    assert response.json()["code"] == "input.invalid"


def test_rejects_incompatible_pipeline(make_client: ClientFactory) -> None:
    response = submit(make_client(), b"%PDF-1.7\n%%EOF", CONVERT, filename="ya-es.pdf")
    assert response.status_code == 422
    assert response.json()["code"] == "pipeline.incompatible"


def test_converter_rejection_marks_job_failed(make_client: ClientFactory, gotenberg: GotenbergStub) -> None:
    gotenberg.status = 400
    client = make_client()
    created = submit(client, docx_bytes(), CONVERT).json()
    final = wait_terminal(client, created["jobId"], created["jobToken"])
    assert final["status"] == "failed"
    assert final["error"]["code"] == "input.invalid"
    result = client.get(f"/v1/jobs/{created['jobId']}/result", headers=auth(created["jobToken"]))
    assert result.status_code == 409


def test_rejects_zip_bombs(make_client: ClientFactory) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"\0" * (50 * 1024 * 1024))
    response = submit(make_client(), buffer.getvalue(), CONVERT)
    assert response.status_code == 422
    assert response.json()["code"] == "limits.exceeded"


def test_rejects_oversized_uploads(make_client: ClientFactory) -> None:
    client = make_client(max_upload_bytes=1024 * 1024)
    response = submit(client, b"%PDF-1.7\n" + b"0" * (3 * 1024 * 1024), CONVERT)
    assert response.status_code == 413
    assert response.json()["code"] == "limits.file_too_large"


def test_private_instance_requires_access_key(make_client: ClientFactory) -> None:
    client = make_client(access_key_hashes=frozenset({access_key_hash()}))
    assert client.get("/v1/capabilities").json()["requiresAccessKey"] is True
    denied = submit(client, docx_bytes(), CONVERT)
    assert denied.status_code == 401
    assert denied.json()["code"] == "auth.required"
    assert submit(client, docx_bytes(), CONVERT, **{"X-Access-Key": "incorrecta"}).status_code == 401
    assert submit(client, docx_bytes(), CONVERT, **{"X-Access-Key": ACCESS_KEY}).status_code == 202


def test_rate_limit_returns_retry_after(make_client: ClientFactory) -> None:
    client = make_client(jobs_per_minute_per_ip=2)
    assert submit(client, docx_bytes(), CONVERT).status_code == 202
    assert submit(client, docx_bytes(), CONVERT).status_code == 202
    limited = submit(client, docx_bytes(), CONVERT)
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) >= 1
    assert limited.json()["code"] == "rate.limited"


def test_unknown_route_is_problem_json(make_client: ClientFactory) -> None:
    response = make_client().get("/v1/no-existe")
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"


@pytest.mark.skipif(shutil.which("ocrmypdf") is None, reason="OCRmyPDF solo está en la imagen Docker")
def test_ocr_real(tmp_path: Path, gotenberg: GotenbergStub) -> None:
    import httpx2

    from tests.conftest import base_settings
    from vitropdf.main import create_app

    pdf = Path(__file__).parent / "data" / "escaneo.pdf"
    if not pdf.exists():
        pytest.skip("Falta tests/data/escaneo.pdf")
    app = create_app(base_settings(tmp_path), http_transport=httpx2.MockTransport(gotenberg.handler))
    with TestClient(app) as client:
        spec = {"steps": [{"tool": "ocr", "languages": ["spa"]}]}
        response = submit(client, pdf.read_bytes(), spec, filename="escaneo.pdf")
        assert response.status_code == 202, response.text
        created = response.json()
        final = wait_terminal(client, created["jobId"], created["jobToken"], timeout=120)
        assert final["status"] == "completed", json.dumps(final)
