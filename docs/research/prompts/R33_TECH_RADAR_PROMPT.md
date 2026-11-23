# Deep-research prompt R33: technology radar (fastest, open-source, future-proof stack)

How to use: Gemini web, Deep Research mode. Paste the context line, then STAGE 1, then in the same chat the
shared STAGE 2 from `R27_TO_R32_PROMPTS.md`. Give both outputs to the main hub with "register R33".

> Context: Roxira is a SaaS (accounting/tax, CRM, ERP, HR, AI legal assistant) built by two people with AI coding
> agents. Today: NestJS/TypeScript backend, Next.js frontend, Python FastAPI AI core, PostgreSQL 17 with PgBouncer,
> Redis, Qdrant, TEI embeddings, LiteLLM gateway, nginx, Docker Compose, GitHub Actions plus a Linux build box.
> Budget is minimal; open source with permissive licences (MIT/Apache/BSD/ISC/CC0, no AGPL/GPL/SSPL/ELv2 in the
> runtime) comes first. Today is 2026-11-21. Output: facts with primary-source URLs and dates, kept separate from
> recommendations. Flag anything you cannot verify.

STAGE 1:
1. For each layer (web backend runtime, frontend build tooling, database and connection pooling, cache/queue, vector
   search and embeddings serving, LLM gateway, reverse proxy, CI/test tooling, container runtime, backup/DR, observability),
   what is the fastest and safest production option as of late 2026, with benchmarks from primary or reproducible sources?
2. Where does Rust (or Go/Zig) give a real, measured advantage for a team our size (single-binary daemons, hot paths,
   security-critical parsing), and where is a rewrite wasteful? List mature Rust components we can adopt instead of writing
   (licence, maintenance status, last release).
3. Upgrade and end-of-life calendar for everything we run (Node, Postgres, Redis/Valkey, Python, Qdrant, nginx, TypeScript,
   Next.js, NestJS): versions, support end dates, breaking changes, recommended order.
4. Emerging technology worth piloting in the next 12 months (databases, queues, edge/runtime, AI serving, agent tooling),
   each with maturity level, licence, risk and a cheap pilot design.
5. A concrete ranked adoption list: what to change now, in 3, 6 and 12 months, with expected gain, effort, rollback and the
   metric to measure on our own workload before committing.
