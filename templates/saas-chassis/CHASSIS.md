# SaaS chassis

A lean, working skeleton for a new global SaaS product (factory milestone F4). Agents write only the
domain logic in `src/features/<name>/`; auth, teams, billing, i18n, AI client, analytics, SEO and ops are here.

Stack (see the house stack): Next.js 16 App Router, TypeScript strict, Tailwind 4, shadcn/ui-style
components, Better Auth (email+password, magic link, organizations, API keys) on Drizzle + PostgreSQL,
merchant-of-record billing behind one adapter, next-intl, Umami.

## Create a product from the chassis

1. **Copy** `templates/saas-chassis/` into a new repo (company GitHub org) and make the first commit.
2. **Rename**: `name` in `package.json`, `NEXT_PUBLIC_APP_NAME`, container/db names in
   `docker-compose.yml`, text in `public/llms.txt`, `content/legal/*.md`, `messages/en.json`.
3. **Install and lock**: `npm install` (commit `package-lock.json`; CI uses `npm ci`).
4. **Migrations**: `npm run db:generate` creates `drizzle/*.sql` from `src/db/schema`; commit them via a
   reviewed PR. Apply with `scripts/migrate.sh` (Docker) or `scripts/migrate.sh --local`.
   Check Better Auth tables still match: `npm run auth:schema` and diff against `src/db/schema/auth.ts`
   (the CLI cannot load files that import `server-only`: use a temporary config with only the plugins, and delete the output file afterwards).
5. **Env**: `cp .env.example .env`, fill values (names only are in git). `BETTER_AUTH_SECRET` from
   `openssl rand -base64 32`. Secrets never go in code or in `NEXT_PUBLIC_*`.
6. **Plans**: edit `config/plans.ts` (names, prices, limits, features). It feeds the pricing section,
   plan limits (`assertWithinLimit`) and billing. Set `PRICE_*` env vars to the provider's price ids.
   Prices in the file are placeholders; the owner decides real prices.
7. **Billing provider**: set `BILLING_PROVIDER` (`paddle` | `lemonsqueezy`; `polar` is a stub) and its
   env vars. In the provider dashboard point the webhook to `https://<domain>/api/webhooks/billing`.
   Checkout carries the organization id as custom data; the webhook writes `subscriptions`.
8. **Domain logic**: copy `src/features/example/` to `src/features/<name>/` (schema, repository, services,
   UI). Re-export the schema from `src/db/schema/index.ts`. Replace the notes/AI demo on the dashboard.
9. **Domain, SEO and legal**: set `NEXT_PUBLIC_APP_URL`; rewrite the landing copy in `messages/*.json`;
   edit `src/app/layout.tsx` metadata, JSON-LD helpers (`src/lib/jsonld.tsx`), `sitemap.ts`; have a
   lawyer review `content/legal/*.md`.
10. **Deploy**: `docker compose up -d --build`, then `scripts/migrate.sh`. The app listens on
    `127.0.0.1:${APP_PORT}` behind Cloudflare/nginx. Health: `GET /api/health`.

## Rules the chassis enforces

- **Tenancy**: every app table has `organization_id` (NOT NULL). Server code gets the tenant only from
  `requireOrg()` (`src/lib/tenant.ts`) and reads/writes through `orgRepo()` (`src/lib/org-repo.ts`),
  which filters every query by it. Never accept an organization id from the request. Platform-level
  exceptions are listed in `src/db/schema/app.ts` (`waitlist`, `webhook_events`).
- **Validation**: every route handler and server action validates input with zod.
- **Secrets**: env only. No default keys in code.
- **AI**: all calls go through `src/lib/ai.ts` to the gateway; model ids live in the gateway config
  (`AI_MODEL_GROUP` is a group name). Anything that renders AI output must use `<AiContent>`
  (EU AI Act Art. 50 label); the `/legal/ai-disclosure` page explains it.
- **Analytics**: funnel events are `signup` (server, auth hook), `activate` (call `track("activate")` at
  the product's first-value moment), `checkout_started` (server action), `paid` (webhook).
- **i18n**: English default, `ar` is the RTL scaffold. Add a locale in `src/i18n/config.ts` and
  `messages/<locale>.json` (missing keys fall back to English). Use logical Tailwind classes
  (`ms-`, `me-`, `ps-`, `text-start`) so RTL works.
- **Not in the chassis (add only when a product needs it)**: usage metering, SBOM scan, rate limiting
  beyond Better Auth defaults, email verification (turn on once SMTP works), social login.

## Layout

```
config/plans.ts            plans, limits, price-id env names
content/legal/*.md         terms, privacy, AI disclosure (editable markdown)
messages/{en,ar}.json      UI strings
src/app/                   routes: (marketing) (auth) (app)/dashboard, api/*
src/db/schema/             auth.ts (Better Auth), app.ts (subscriptions, webhooks, waitlist)
src/features/<name>/       domain code (example/ is the pattern)
src/lib/                   auth, tenant, org-repo, billing/, ai, track, jsonld, mail
scripts/migrate.sh         migrations; Dockerfile, docker-compose.yml, .github/workflows/ci.yml
```
