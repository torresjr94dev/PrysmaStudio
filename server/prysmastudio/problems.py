from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse


class Problem(Exception):
    """Error esperado y tipado (RFC 9457). Los mismos `code` que usa el motor del navegador."""

    def __init__(self, status: int, code: str, title: str, detail: str | None = None) -> None:
        super().__init__(f"{code}: {detail or title}")
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail

    def to_dict(self, instance: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "type": f"/docs/errors/{self.code}",
            "title": self.title,
            "status": self.status,
            "code": self.code,
        }
        if self.detail:
            body["detail"] = self.detail
        if instance:
            body["instance"] = instance
        return body


def problem_response(
    problem: Problem, instance: str | None = None, headers: dict[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(
        problem.to_dict(instance),
        status_code=problem.status,
        media_type="application/problem+json",
        headers=headers,
    )


def internal_problem() -> Problem:
    return Problem(500, "internal", "Error interno", "Ocurrió un error inesperado. Intenta de nuevo.")
