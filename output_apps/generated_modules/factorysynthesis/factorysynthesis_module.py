"""Roxira Software Foundry router — auto-mounted by ``run_unified_server.py``.

Exposes the foundry HTTP surface consumed by the mission-control dashboard and
the ephemeral sandbox worker:

    * ``POST /api/v1/factory/synthesize-app``          → enqueue a build (202)
    * ``POST /api/v1/factory/synthesize``              → alias of the above
    * ``GET  /api/v1/factory/synthesize-app/{app_id}`` → live pipeline stages

The status endpoint reads the exact same store the ``EphemeralRunner`` writes
to (Redis when ``REDIS_URL`` is set, otherwise the shared sandbox volume), so
the reported stages and subdomain always match the worker's state.
"""

from output_apps.ecosystem_core.src.factory.ephemeral_runner import create_factory_router

router = create_factory_router()
