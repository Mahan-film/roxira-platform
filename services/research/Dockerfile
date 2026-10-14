# syntax=docker/dockerfile:1
# Self-hosted deep-research API (roxira-research). PUBLIC research questions only.
# verify: the base tag is pinned exactly on purpose — confirm it still exists on
# Docker Hub before building (python:3.12-slim-bookworm drift); do not silently bump.
FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN pip install --no-cache-dir \
    "gpt-researcher==0.16.1" \
    "fastapi==0.143.0" \
    "uvicorn==0.54.0"

# Non-root runtime; the app needs no write access beyond its own temp dir.
RUN useradd --create-home --uid 10001 research
COPY app.py /app/app.py
USER 10001

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
