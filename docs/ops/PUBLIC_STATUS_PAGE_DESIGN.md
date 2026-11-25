# Public Status Page Design (Host-Independent)

Status: **Proposed design** (T343).

## 1. Goal & Non-Negotiable Requirement

Customers must be able to check service availability **even when the production server is completely offline, unreachable, or undergoing a full restore**. Therefore, the public status page MUST NOT be served from the production host, MUST NOT query the production database, and MUST NOT depend on production Nginx/Docker.

## 2. Architecture Overview

```text
  External Probe (GitHub Actions cron / off-host uptime worker)
        │  HTTPS GET (health endpoints, public landing, API readiness)
        ▼
  Production Endpoints  ──(timeout / 5xx / TLS failure)──►  Probe records state
        │
        ▼
  Static Generator (Python stdlib, no runtime DB/server needed)
        │  writes status.json + static index.html
        ▼
  Static Host / CDN (Cloudflare Pages, GitHub Pages, or Object Storage + CDN)
        │
        ▼
  Customers view https://status.<domain> (always reachable)
```

## 3. Monitored Checks (Public-Safe)

Each check probes only public, unauthenticated, read-only endpoints and records `operational | degraded | outage` plus latency (ms) and timestamp (UTC):

| Component | Probe Target | Pass Criteria |
|---|---|---|
| **Web Portal** | `GET /` and `GET /login` | HTTP 200, `< 3000 ms` |
| **Enterprise API** | `GET /api/backend/v1/health` | HTTP 200 |
| **AI Core (Smart Judge)** | `GET /api/smartjudge/health` | HTTP 200 |
| **Public Legal Pages** | `GET /terms` and `GET /privacy` | HTTP 200 |

No secrets, internal IPs, stack traces, or tenant data are ever included in `status.json` or `index.html`.

## 4. `status.json` Schema

```json
{
  "generated_at": "2026-11-24T10:00:00Z",
  "overall": "operational",
  "components": [
    { "id": "web", "name": "Web Portal", "status": "operational", "latency_ms": 142 },
    { "id": "api", "name": "Enterprise API", "status": "operational", "latency_ms": 95 },
    { "id": "ai", "name": "Smart Judge AI", "status": "operational", "latency_ms": 210 }
  ],
  "incidents": [
    {
      "id": "inc-2026-11-24-01",
      "title": "Scheduled maintenance",
      "status": "resolved",
      "updated_at": "2026-11-24T09:00:00Z",
      "message": "Completed without customer impact."
    }
  ]
}
```

## 5. Manual Override During Incidents

If an automated probe cannot distinguish a partial degradation or if an Incident Commander needs to post a notice immediately:
- An operator updates a small `incidents.json` file in the status-page repository/bucket (or triggers the status-publish workflow) to publish a banner and incident timeline using the template in `docs/ops/PILOT_RUNBOOK.md`.
- Because the status site is static HTML/JSON on an independent CDN, updates propagate within seconds and survive a total production host outage.

## 6. Follow-Up Implementation Steps (Separate PRs)

1. Choose hosting target (Cloudflare Pages or GitHub Pages) and configure DNS CNAME (`status.<domain>`).
2. Add the external probe script + static HTML template (zero external JS/CDN dependencies, RTL/LTR friendly).
3. Wire scheduled probe + manual incident dispatch workflow.
