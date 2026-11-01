from __future__ import annotations

import asyncio
import logging
import shutil
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import httpx2
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import router
from .config import Settings
from .jobs import JobManager
from .problems import Problem, internal_problem, problem_response
from .security import RateLimited

logger = logging.getLogger("prysmastudio")

_HTTP_CODES = {
    400: "input.invalid",
    404: "not_found",
    405: "method_not_allowed",
    413: "limits.file_too_large",
}


async def detect_ocr_languages() -> frozenset[str]:
    """Idiomas instalados en Tesseract. Sin Tesseract el OCR se deshabilita; el arranque no falla."""
    binary = shutil.which("tesseract")
    if binary is None:
        return frozenset()
    try:
        process = await asyncio.create_subprocess_exec(
            binary, "--list-langs", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=10)
    except (OSError, TimeoutError):
        logger.warning("No se pudieron listar los idiomas de Tesseract; OCR deshabilitado")
        return frozenset()
    lines = stdout.decode(errors="replace").splitlines()[1:]
    return frozenset(line.strip() for line in lines if line.strip() and line.strip() not in {"osd", "equ"})


def create_app(
    settings: Settings | None = None,
    *,
    http_transport: httpx2.AsyncBaseTransport | None = None,
    ocr_languages: frozenset[str] | None = None,
) -> FastAPI:
    resolved = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        languages = ocr_languages if ocr_languages is not None else await detect_ocr_languages()
        async with httpx2.AsyncClient(transport=http_transport, follow_redirects=False) as http:
            manager = JobManager(resolved, http, languages)
            await manager.start()
            app.state.settings = resolved
            app.state.manager = manager
            try:
                yield
            finally:
                await manager.stop()

    app = FastAPI(title="PrysmaStudio", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(router)

    @app.middleware("http")
    async def no_store(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(Problem)
    async def on_problem(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, Problem)
        headers = {"Retry-After": str(exc.retry_after)} if isinstance(exc, RateLimited) else None
        return problem_response(exc, request.url.path, headers)

    @app.exception_handler(StarletteHTTPException)
    async def on_http(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, StarletteHTTPException)
        code = _HTTP_CODES.get(exc.status_code, f"http.{exc.status_code}")
        detail = exc.detail if isinstance(exc.detail, str) else None
        return problem_response(
            Problem(exc.status_code, code, "Solicitud no válida", detail), request.url.path
        )

    @app.exception_handler(RequestValidationError)
    async def on_validation(request: Request, exc: Exception) -> Response:
        return problem_response(Problem(422, "input.invalid", "Solicitud inválida"), request.url.path)

    @app.exception_handler(Exception)
    async def on_unexpected(request: Request, exc: Exception) -> Response:
        logger.exception("Error no controlado en %s", request.url.path)
        return problem_response(internal_problem(), request.url.path)

    return app


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    # Sin access log: contendría IPs de usuarios (dato personal) y no aporta para operar un solo nodo.
    uvicorn.run(
        "prysmastudio.main:create_app",
        factory=True,
        host="0.0.0.0",  # noqa: S104 — solo es alcanzable desde la red interna de Docker, detrás de Caddy
        port=8080,
        proxy_headers=False,
        server_header=False,
        access_log=False,
    )


if __name__ == "__main__":
    run()
