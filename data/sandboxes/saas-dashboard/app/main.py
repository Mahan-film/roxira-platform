"""Generated FastAPI microservice (Roxira Software Foundry sandbox)."""

from __future__ import annotations

import os
import time

from fastapi import FastAPI

APP_ID = "saas-dashboard"
APP_NAME = "saas-dashboard"
BUILD_PROMPT = "Create a modern Next.js admin portal"
STARTED_AT = time.time()

app = FastAPI(title=APP_NAME or APP_ID, version="1.0.0")


@app.get("/health")
def health() -> dict:
    """Readiness/liveness payload used by the sandbox health probe."""
    return {
        "status": "healthy",
        "app_id": APP_ID,
        "uptime_seconds": round(time.time() - STARTED_AT, 3),
    }


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {
        "app_id": APP_ID,
        "app_name": APP_NAME,
        "prompt": BUILD_PROMPT,
        "runtime": os.getenv("ROXIRA_TEMPLATE", "fastapi-microservice"),
    }
