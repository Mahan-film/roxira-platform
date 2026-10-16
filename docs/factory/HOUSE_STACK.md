# House stack (fed to every factory spec)

The factory reuses what we already run and know. A spec may deviate only with a stated reason
(a hard requirement this stack cannot meet), never for preference.

- **Web app:** Next.js (App Router, TypeScript, Tailwind, shadcn/ui), i18n, SEO/GEO kit (sitemaps, JSON-LD, llms.txt).
- **Business API:** NestJS (Controller-Service-DTO-Repository, class-validator), or the Next.js server for small products.
- **AI / retrieval core:** Python FastAPI service; Qdrant vectors with local BAAI/bge-m3 embeddings (TEI);
  ingestion pipeline with allowlist + validation gates; citation guard (answers only from retrieved sources,
  refuse otherwise); golden test sets with recall@5 gates before any collection switch.
- **Data:** PostgreSQL (tenant column on every table, access checks in the repository layer), Redis.
- **LLM access:** our LiteLLM key pool (free models first, paid DeepSeek fallback; ids only in config).
- **Auth:** our existing OTP/JWT + tenants pattern; for new global products an open-source library with
  organisations and API keys, self-hosted on our Postgres (no paid auth SaaS).
- **Billing:** merchant of record (Paddle / Lemon Squeezy / Polar) behind one adapter; no self-hosted billing
  engine until usage pricing is proven.
- **Ops:** Docker Compose on a Hetzner server, Cloudflare in front, our autodeploy (backup, migrate, smoke,
  rollback), monitor, owner bot, SBOM scan, workbench checks. No Kubernetes, no Supabase, no Kong.
- **Cost rule:** open source and self-hosted first; a paid service only when it removes a hard problem.
