# roxira-research (self-hosted deep research)

A loopback-only FastAPI service that wraps [GPTResearcher](https://github.com/assafelovic/gpt-researcher)
(`gpt-researcher==0.16.1`). No UI. It answers **public** research questions and
returns a Markdown report plus the sources it used.

> **PUBLIC questions only.** LLM calls go through the key-pool `agent-free`
> group (`docs/infra/KEY_POOL.md`), which may route to free models that log or
> train on prompts. Never send customer/case data, case files, or anything
> covered by lawyer-client privilege to this service (AGENTS.md section 4).

## Endpoints

- `POST /research`
  ```json
  {
    "query": "مهلت تجدیدنظرخواهی از رأی دادگاه حقوقی",
    "report_type": "research_report",
    "tone": null,
    "max_sources": 10,
    "language": "fa"
  }
  ```
  - `report_type` ∈ `research_report` | `resource_report` | `outline_report` (default `research_report`).
  - `max_sources` optional, `1..20`; the response is trimmed to this many sources.
  - `language` default `fa` (mapped to `persian`); the env default is `persian`.
  - Returns `{report_markdown, sources:[{url,title}], costs?, duration_s}`.
  - At most **2** jobs run concurrently (`asyncio.Semaphore`); a hard **900 s**
    timeout applies and returns HTTP 504.
- `GET /health` → `{"ok": true}`.

### Auth

Header auth is optional. When `RESEARCH_TOKEN` is set, every `POST /research`
must send `Authorization: Bearer <token>` (compared in constant time); otherwise
it gets HTTP 401. With `RESEARCH_TOKEN` unset there is no auth, which is safe
only because the port is bound to `127.0.0.1`.

## Configuration (env only, never hardcode)

| Variable | Default | Notes |
|---|---|---|
| `OPENAI_BASE_URL` | `http://roxira_keypool:4000/v1` | Key-pool gateway (model **group** names are the model names). |
| `OPENAI_API_KEY` | `${KEYPOOL_MASTER_KEY}` | Gateway master key from `/opt/roxira_platform/.env`. |
| `FAST_LLM` / `SMART_LLM` / `STRATEGIC_LLM` | `openai:agent-free` | Free-first group; public data only. |
| `EMBEDDING` | `openai:text-embedding-3-small` | **Embeddings need a real provider.** The key-pool has no embedding model in `agent-free`, so retrieval fails until `EMBEDDING` (or an embedding server) is configured. The default is a placeholder, not a promise. |
| `RETRIEVER` | `searx` | Uses the local SearXNG. |
| `SEARX_URL` | `http://research-stack-searxng-1:8080` | Container `research-stack-searxng-1`, internal port **8080** (host publishes `127.0.0.1:8888`). Verified against `docker/research-stack/docker-compose.yml`. |
| `SCRAPER` | `bs` | Lightweight BeautifulSoup scraper. |
| `MAX_ITERATIONS` | `3` | Planner/search iterations. |
| `LANGUAGE` | `persian` | Report language. |
| `RESEARCH_TOKEN` | unset | Optional bearer token for `POST /research`. |

## Docker

`services/research/docker-compose.research.yml` builds `services/research/Dockerfile`
(base image pinned to `python:3.12.11-slim-bookworm` — **verify** the tag exists
before building) and runs container `roxira_research`:

- Published on `127.0.0.1:8090:8000` only (port 8090 is not in the AGENTS.md
  reserved list); `mem_limit 1g`, `restart: unless-stopped`, `cap_drop: ALL`.
- `env_file: /opt/roxira_platform/.env` (values are referenced only via `${...}`;
  `install.sh` passes `--env-file` so interpolation sees the same file).
- Joins two **external** networks so both hostnames resolve:
  - `roxira-keypool_default` — default bridge of the key-pool compose project
    (`-p roxira-keypool` in `scripts/infra/key_pool/install.sh`), resolving
    `roxira_keypool`.
  - `research` — declared in `docker/research-stack/docker-compose.yml`,
    resolving `research-stack-searxng-1`.

## Owner commands

```bash
# on the server, in the repo checkout
bash services/research/install.sh            # dry-run: port check, env file, build/run plan
bash services/research/install.sh --apply    # build the image and start roxira_research
bash services/research/smoke.sh              # GET /health then one short outline research
```

`install.sh` refuses if port 8090 is busy (unless it holds our own container) or
if either external network is missing — start the key pool and
`docker/research-stack` first. `smoke.sh` prints the source count and the first
300 characters of the report, never secrets.

Offline unit tests (mock GPTResearcher; no network):

```bash
pytest services/research/test_app.py -q
```
