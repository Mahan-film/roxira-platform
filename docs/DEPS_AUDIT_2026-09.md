# Dependency & vulnerability audit — 2026-09

Read-only audit for GitHub issue #106. **No dependency, lockfile, or manifest was changed**; this PR is docs-only.
Date: 2026-09-29. Scope: React/Next.js frontend, Python side of the repo, and the packages pinned in the tracked requirements files.

## Method & environment

| Target | Command | Note |
| --- | --- | --- |
| Frontend vulns | `npm audit --omit=dev --json` (in `output_apps/enterprise_hub/frontend`) | `node_modules` absent; npm resolved from the committed `package-lock.json`. |
| Frontend drift | `npm outdated --json` | Same dir. |
| Python drift | `python3 -m pip list --outdated` | Filtered to packages named in requirements files + `pyproject.toml`. |
| Python CVEs | `pip-audit -r <file>` | **Not runnable** — `pip-audit` is not installed and installing it would violate the read-only rule. |
| Requirements files | `git ls-files '*requirements*'` | Read-only; returned the 3 files below. |

- Node `v26.5.1` / npm `11.17.0` on the audit host; the frontend prod image builds on `node:20-alpine`.
- Python `3.13.6` / pip `25.2` (system Python on the audit host). **Prod does not use these versions**: `Dockerfile.prod` is `python:3.11-slim` and installs deps **unpinned** (`pip install psycopg fastapi uvicorn ...`), so prod already tracks the newest release at build time, not the versions below.
- `pip list --outdated` reflects the audit host, not the prod container. Treat Python "current" values as a drift snapshot, not a prod inventory.
- The NestJS backend (`output_apps/enterprise_hub/package.json`) is **out of scope** for #106 (frontend audit was requested); it has no committed lockfile, so it was not audited.

## 1. Frontend vulnerabilities — `npm audit --omit=dev`

| Metric | Value |
| --- | --- |
| Advisories in production dependency tree | **0** (info 0 / low 0 / moderate 0 / high 0 / critical 0) |
| Production dependencies scanned | 349 (677 total incl. dev/optional) |
| Dev dependencies | Excluded by `--omit=dev` (not audited here) |

No reachable production advisory exists for the locked frontend tree as of this run.

## 2. Frontend version drift — `npm outdated`

| Package | Pinned current | Wanted | Latest | Direct? | Reachable in prod | Action |
| --- | --- | --- | --- | --- | --- | --- |
| `next` | 16.3.4 | 16.3.4 | 16.3.7 | yes | yes | plan |
| `react` | 19.2.8 | 19.2.8 | 19.3.0 | yes | yes | plan |
| `react-dom` | 19.2.8 | 19.2.8 | 19.3.0 | yes | yes | plan |
| `cn` | 0.2.6 | 0.2.6 | 0.4.0 | yes | yes | plan |
| `@base-ui/react`, `class-variance-authority`, `lucide-react`, `shadcn`, `tw-animate-css` | current | same | same | yes | yes | ignore (already latest) |

`wanted == current` for the three pinned packages because `next`/`react`/`react-dom` are exact pins and `cn` has no newer release inside its `^` range. No `fixAvailable` entry exists in the audit JSON.

## 3. Python requirements files (`git ls-files '*requirements*'`)

| File | Role | Deps |
| --- | --- | --- |
| `ci/requirements-test.txt` | CI unit tests only | `pytest`, `pytest-timeout`, `httpx`, `pydantic`, `pyyaml`, `fastapi`, `psycopg[binary]`, `python-multipart` |
| `data/sandboxes/iran-enterprise-erp/requirements.txt` | Generated sandbox demo app | `fastapi==0.115.0`, `uvicorn[standard]==0.30.6`, `sqlalchemy[asyncio]>=2.0.30`, `aiosqlite>=0.19.0` |
| `data/sandboxes/saas-dashboard/requirements.txt` | Generated sandbox demo app | `fastapi==0.115.0`, `uvicorn[standard]==0.30.6` |

The main project manifest is `pyproject.toml` (`[project].dependencies` + groups `dev`, `documents`, `legal-graph`, `research-mcp`); it is not a `*requirements*` file but was included for completeness.

## 4. Python version drift — `pip list --outdated`

Installed on the audit host; packages absent from this table are already current relative to their constraints.

| Package | Current | Latest | Declared in | Reachable in prod | Action |
| --- | --- | --- | --- | --- | --- |
| `python-multipart` | 0.0.20 | 0.0.32 | `ci/requirements-test.txt` | yes (installed unpinned in prod image) | plan |
| `fastapi` | 0.116.1 | 0.141.1 | all 3 requirements files + prod | yes (unpinned in prod) | plan |
| `uvicorn` | 0.35.0 | 0.54.0 | both sandbox requirements files + prod | sandbox only (prod installs unpinned) | ignore for main prod |
| `SQLAlchemy` | 2.0.43 | 2.1.1 | iran-enterprise-erp sandbox + prod | prod installs unpinned (already 2.1.x) | ignore for main prod |
| `psycopg` / `psycopg-binary` | 3.3.4 | 3.3.6 | `ci/requirements-test.txt`, `pyproject.toml`, prod | yes | plan |
| `PyYAML` | 6.0.2 | 6.0.3 | `ci/requirements-test.txt`, `pyproject.toml` | yes (transitive in prod) | plan |
| `PyMuPDF` | 1.26.4 | 1.28.2 | `pyproject.toml` `documents` + prod | yes (document parser) | plan |
| `beautifulsoup4` | 4.13.5 | 4.15.0 | `pyproject.toml` `dev` group only | no (dev/CI only) | ignore |
| `pytest`, `pytest-timeout`, `httpx`, `pydantic`, `aiosqlite`, `django*`, `mypy`, `parsel`, `ruff`, `crawlee`, `docling`, `python-docx`, `lightrag-hku`, `mcp` | current | — | — | — | ignore |

**Severity for every Python row is `unknown`**: it cannot be asserted without advisory data, and `pip-audit` could not be installed. Do not read "unknown" as "safe".

## Ranked findings (risk × effort)

| # | Package | Current → latest | Severity | Prod? | Action | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `next` | 16.3.4 → 16.3.7 | none known | yes | upgrade now | Patch-channel release on the prod web tier; trivial, low-risk. Requires editing the exact pin in `package.json`. |
| 2 | `python-multipart` | 0.0.20 → 0.0.32 | unknown | yes | plan | Parses untrusted multipart uploads on the public API; large delta (0.0.20→0.0.32). Verify changelog then bump. |
| 3 | `PyMuPDF` | 1.26.4 → 1.28.2 | unknown | yes | plan | Parses untrusted case PDFs. Historically CVE-prone; confirm advisory status before bumping. |
| 4 | `fastapi` | 0.116.1 → 0.141.1 | unknown | yes | plan | Large minor delta; needs a regression pass over the FastAPI routes. |
| 5 | `psycopg` / `psycopg-binary` | 3.3.4 → 3.3.6 | unknown | yes | plan | Patch bump on the prod DB driver; low effort, run with the DB integration tests. |
| 6 | `PyYAML` | 6.0.2 → 6.0.3 | unknown | yes | plan | Small patch; transitive in prod via langgraph/docling. |
| 7 | `react` + `react-dom` | 19.2.8 → 19.3.0 | none known | yes | plan | Minor bump, exact pins; pair with the Next.js bump in one frontend PR. |
| 8 | `cn` | 0.2.6 → 0.4.0 | none known | yes | plan | Minor bump of a UI helper; low impact. |
| 9 | `uvicorn` | 0.35.0 → 0.54.0 | unknown | sandbox only | ignore | Only pinned in generated sandbox demos, outside `docker-compose.prod.yml`. |
| 10 | `SQLAlchemy` | 2.0.43 → 2.1.1 | unknown | no (unpinned in prod) | ignore | Sandbox pin is stale; prod already installs the latest 2.x. |
| 11 | `beautifulsoup4` | 4.13.5 → 4.15.0 | unknown | no | ignore | Dev/CI-only group. |

## Limitations

- `pip-audit` was not installable under the read-only rule, so **no Python CVE data exists in this report**; severity is `unknown`, not clean.
- `npm audit` ran without `node_modules` against `package-lock.json`; accurate for advisory mapping, but the lockfile's resolved versions are the authority, not the installed tree.
- The NestJS backend and the generated `data/sandboxes/*/package.json` apps were not audited (out of #106 scope).
- "Prod?" reflects `docker-compose.prod.yml` + `Dockerfile.prod`; the Python image installs unpinned, so prod versions can already be newer than the drift rows above.

## Reproduce (read-only, no changes)

```bash
cd output_apps/enterprise_hub/frontend && npm audit --omit=dev --json && npm outdated --json
git ls-files '*requirements*'
python3 -m pip list --outdated
pip-audit -r ci/requirements-test.txt   # not installed at audit time
```