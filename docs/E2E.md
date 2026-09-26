# E2E smoke tests (W14)

Read-only Playwright checks against the live site (`https://ghazihoushmand.ir`
by default). No secrets, no repo writes.

## What runs
- `e2e/tests/homepage.spec.ts` — `/` loads, HTTP < 400, non-empty Persian text.
- `e2e/tests/pricing.spec.ts` — `GET /api/v1/apps/judge/payments/pricing-matrix` (read-only; create-invoice is deliberately not called)
  with `{}` returns 200 (sandbox invoice only, no real payment).
- `e2e/tests/chat.spec.ts` — `POST /api/v1/apps/judge/chat` with a fixed Persian
  legal question returns `status: SUCCESS` and a non-empty reply within 60s.
  This is the **only** test that costs an LLM call — one per run.

## When
`.github/workflows/e2e-smoke.yml` runs daily on a schedule plus manual
`workflow_dispatch` (optional `base_url` input). It is **not** part of PR CI
(`ci.yml`). On failure it uploads the Playwright HTML report and opens or
updates one issue labelled `e2e-failure`.

The `e2e-failure` label must exist in the repo (create it once via the GitHub
UI) or issue creation on failure will error.

## Run locally
```bash
cd e2e
npm install
npx playwright install chromium
npm test                 # against https://ghazihoushmand.ir
E2E_BASE_URL=http://localhost:8000 npm test   # against another target
npm run report            # open the last HTML report
```
