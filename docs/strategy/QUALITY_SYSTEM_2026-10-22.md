# Quality system — why bugs reached the owner and how we stop them (2026-10-22)

Trigger: the owner, in Safari on roxira.ir/app/import, saw the full-screen «فایل را رها کنید» overlay stuck
over the page, so no file could be dropped. It was the latest of ten defects in one day that the owner (or
the hub) found in production or by hand instead of an automated gate.

## 1. Audit: every defect of 2026-10-22, by the gate that should have caught it
| # | Defect | Found by | Missing gate |
| --- | --- | --- | --- |
| 1 | Backend deploys failed #807–#812 (Dockerfile missed `mcp/`); site kept the old UI | owner ("still the same page") | build gate (G2, now live #820) + post-deploy check (G4) |
| 2 | Pricing endpoint 20 s → smoke failed, deploy rolled back | deploy log | G4 alert (rollback was silent) |
| 3 | Migration `transaction = false` rejected by the runner | deploy log | G3 (sandbox runs migrations) |
| 4 | Pre-migration backup verify died on SIGPIPE | deploy log | G4 alert |
| 5 | DB import wrote 3/31 accounts, 0 journal lines, no undo batch (5 causes) | manual E2E sandbox | G3 |
| 6 | HR contracts 400 (`ParseIntPipe({optional})` not honoured) | owner | G3 browser test |
| 7 | Trial balance 400 for MULTI-currency accounts, wrong USD totals | manual UI test | G3 |
| 8 | Package status 404 from a half-written meta.json | manual UI test | G3 |
| 9 | Drop overlay stuck (local drop zone + Safari event pairing) | owner, Safari | G3 in **WebKit** |
| 10 | 13 failing Python unit tests on main → pre-push gate skipped | hub | hygiene rule: main is always green |

Root causes (not symptoms):
1. **We tested code, not the product.** 395 unit tests passed while the import was broken; nothing clicked
   through the real pages. Unit tests and typecheck cannot see wiring, migrations, browser events or data.
2. **Only Chromium, never Safari.** The owner and most Iranian Mac/iPhone users run Safari (WebKit), which
   pairs drag events differently. Our only browser tests (e2e/, prod read-only smoke) ran Chromium.
3. **"Merged" was treated as "live".** Four failed deploys went unnoticed for hours; no post-deploy check
   compared the running image with the merged commit, and no alert fired.
4. **No production error signal.** Browser errors and stuck UI are invisible to us until the owner reports.
5. **Red gates get skipped.** A permanently failing step teaches everyone to bypass it.
6. **Cheap-agent output was merged on diff review alone** for UI and data paths that need behavioural proof.

## 2. Decisions (research-backed)
- **Pre-merge ephemeral environment per change (G3).** Industry practice: run E2E on an isolated,
  production-like, freshly seeded environment per PR, torn down automatically, and gate the merge on it
  ([Qovery](https://qovery.com/blog/how-to-use-ephemeral-environments-for-end-to-end-testing),
  [Northflank](https://northflank.com/blog/ephemeral-testing-environments)). We already have the core (the srv1
  rxtest sandbox: prod schema, migrations, test tenant); it moves into `scripts/infra/e2e/` and gains the
  frontend container.
- **Playwright in Chromium + WebKit.** WebKit is Safari's engine and Playwright drives it headless on Linux;
  file drops are tested by dispatching drag events with a real `DataTransfer` (or `locator.drop()` on newer
  Playwright) ([BrowserStack guide](https://www.browserstack.com/guide/playwright-drag-and-drop)).
  Every spec fails on uncaught page errors.
- **Post-deploy verification (G4).** After autodeploy: running image label `GIT_SHA` == merged SHA, plus a
  browser smoke in both engines; failure → Telegram alert (no silent rollbacks).
- **Client error reporting, in-house and small.** `window.onerror` / unhandled rejections / React error
  boundaries → `POST /enterprise-hub/client-errors` → structured log + rate-limited Telegram alert.
  GlitchTip/Bugsink (Sentry-SDK compatible, ~512 MB RAM) are the upgrade path once srv1 has headroom
  ([comparison](https://xgenious.com/best-self-hosted-sentry-alternatives/)); not now (RAM budget).
- **Keep the stack.** NestJS + Next + Postgres are not the cause; every defect above was a missing check, not
  a wrong technology. No rewrite.

## 3. Definition of done (binding for hub and agents)
A change touching `/app` pages, import, accounting, invoicing, HR, payments, migrations or Dockerfiles is done
only when: G1 workbench (tsc/lint/unit) ✔ → G2 docker build ✔ → G3 app E2E in Chromium **and** WebKit ✔ →
merged → G4 deployed SHA + browser smoke ✔. "Done" to the owner only after G4. Main must stay green: a
failing test is fixed or quarantined with an issue the same day, never skipped silently.

## 4. Status
| Item | Status |
| --- | --- |
| Drop overlay fix (watchdog on dragover, hide on any drop/dragend/blur/Esc, off on /app/import) | merged #826 |
| G2 docker build in workbench | live (#820) |
| G3 `scripts/infra/e2e/` + `e2e/app` Playwright (chromium+webkit) | in progress |
| G4 GIT_SHA labels + post-deploy browser smoke + alert | in progress |
| Client error reporting endpoint + reporter | in progress |
| 13 red Python unit tests | in progress (separate session) |
| Lint debt: 20 eslint errors (React 19 `set-state-in-effect`, refs in render) | next, via taskq |
