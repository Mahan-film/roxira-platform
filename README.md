# Roxira OS & Smart Judge

Monorepo for **Roxira OS** (`roxira.net` / `roxira.ir`), a multi-tenant enterprise SaaS platform, and **Smart Judge** (`ghazihoushmand.ir`), its Iranian legal-AI sub-platform.

## Layout

| Path | What lives there |
| --- | --- |
| `run_unified_server.py` | FastAPI/Uvicorn entrypoint (`:8000`) that mounts every generated module's router, `/health`, and the MCP hub |
| `output_apps/generated_modules/smartjudge/` | Smart Judge AI core: legal graph (LightRAG), documents, realtime voice, agents |
| `output_apps/generated_modules/*` | Other enterprise modules (finance, invoicing, HR, inventory, payment gateway, auth, …) |
| `output_apps/enterprise_hub/` | NestJS backend and Next.js frontend (`frontend/`) |
| `src/` | Shared libraries: agent runtime, legal intelligence, security, automation |
| `scripts/` | Benchmarks, ingestion, backup and deployment helpers |
| `docker-compose.prod.yml`, `nginx.conf` | Production stack (app, Postgres, PgBouncer, Redis, Qdrant, Nginx) |

See [`AGENTS.md`](AGENTS.md) for the engineering standard that applies to all contributions.

## Getting started

```bash
cp .env.example .env   # fill in the keys you need
uv sync
uv run python run_unified_server.py
```

Then check `http://localhost:8000/health`.

## Tests and linting

```bash
uv run pytest
uv run ruff check .
```
