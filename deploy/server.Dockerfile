# syntax=docker/dockerfile:1.7
FROM python:3.15-slim-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng ghostscript \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.2 /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --extra ocr
COPY server/prysmastudio ./prysmastudio
# El servidor corre como 10001: no depender de la umask de quien construye.
RUN chmod -R a+rX /app/prysmastudio
RUN groupadd --system --gid 10001 prysma \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin prysma
USER 10001
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PRYSMA_WORK_DIR=/work
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/v1/health', timeout=3)"]
CMD ["python", "-m", "prysmastudio.main"]
