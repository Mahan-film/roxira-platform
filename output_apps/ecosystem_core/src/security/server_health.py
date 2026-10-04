"""Health endpoints for the unified server.

Public ``GET /health`` exposes only coarse status. Internal module names
(``failed_imports``) are served by ``GET /health/details``, which answers 404
unless the caller sends a valid ``X-Admin-Key`` (env ``ADMIN_HEALTH_KEY``).
"""
import hmac
import os
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request


def build_health_router(
    get_loaded_count: Callable[[], int],
    get_failed_imports: Callable[[], list[str]],
    service: str = "roxira-unified-server",
    version: str = "3.6.0",
) -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    async def health():
        return {
            "status": "ONLINE",
            "service": service,
            "version": version,
            "loaded_routers": int(get_loaded_count()),
        }

    @router.get("/health/details")
    async def health_details(request: Request):
        expected = os.environ.get("ADMIN_HEALTH_KEY", "")
        supplied = request.headers.get("x-admin-key", "")
        if not expected or not hmac.compare_digest(
            supplied.encode("utf-8"), expected.encode("utf-8")
        ):
            raise HTTPException(status_code=404, detail="Not Found")
        return {
            "status": "ONLINE",
            "service": service,
            "version": version,
            "loaded_routers": int(get_loaded_count()),
            "failed_imports": list(get_failed_imports()),
        }

    return router
