# Audit of Timer-Based Polling in BullMQ Consumers

> Task: #425 (Split of #365 b).  
> Scope: Audit of `setInterval` and sleep/poll loops across `output_apps/enterprise_hub/modules` and `output_apps/ecosystem_core`.  
> Guardrail: `output_apps/enterprise_hub/modules/data_import` is the laptop's module — findings are documented here without modifying code.

---

## 1. Executive Summary

This audit investigated whether any BullMQ queue consumers or related services in `output_apps/enterprise_hub/modules` and `output_apps/ecosystem_core` use timer-based polling (`setInterval`, `setTimeout`, or `sleep` loops) to check queue/job status instead of event-driven listeners (`QueueEvents` with `'completed'` or `'failed'`).

**Findings:**
1. **Zero timer-based BullMQ job status polling**: No service or consumer polls BullMQ job state via `job.getState()` or `queue.getJob()` in a loop. All BullMQ consumers in the enterprise backend are already event-driven `@Processor` classes implementing `WorkerHost`.
2. **`setInterval` occurrences (3 total)**:
   - 1 in backend: `package-store.service.ts:115` (disk TTL sweep of temporary upload scratch files).
   - 2 in frontend/static HTML: `roxira_index.html:501` and `ghazi_landing.html:834` (browser OTP countdown timers).
3. **Queue-driven polling**: Moadian tax transmission (`tax-transmission.service.ts:130` and `moadian.service.ts:457`) uses delayed BullMQ jobs to poll an *external governmental HTTP API*, not an internal queue status.
4. **All identified timers serve legitimate, non-queue operational purposes** (garbage collection, container readiness wait, stream flow control, or external HTTP inquiry) and should be left as is.

---

## 2. Grep Evidence & Findings Matrix

### 2.1 Grep Command: `setInterval`

```bash
grep -rn "setInterval" output_apps/enterprise_hub/modules output_apps/ecosystem_core
```

| Path:Line | Snippet / Purpose | Queue-Status Poll? | Recommendation |
|---|---|:---:|---|
| `output_apps/enterprise_hub/modules/data_import/services/package-store.service.ts:115` | `this.sweepTimer = setInterval(() => void this.sweepExpired(), PACKAGE_SWEEP_INTERVAL_MS);` (TTL-based scratch disk file cleanup) | **No** | **Leave as is**. This is a disk maintenance sweeper purging expired temporary files older than TTL (15 min interval). It does not query or poll any BullMQ queue. Note: `data_import` is protected laptop module. |
| `output_apps/ecosystem_core/src/api/static/roxira_index.html:501` | `otpCountdown = setInterval(() => { ... }, 1000);` (Browser UI login countdown) | **No** | **Leave as is**. Client-side UI timer decrementing the 2-minute OTP resend timer in static HTML login screen. |
| `output_apps/ecosystem_core/src/api/static/ghazi_landing.html:834` | `otpCountdown = setInterval(() => { ... }, 1000);` (Browser UI landing page countdown) | **No** | **Leave as is**. Client-side UI timer for OTP resend countdown on landing page. |

---

### 2.2 Grep Command: Sleep & Polling Loops in `enterprise_hub/modules`

```bash
grep -rn "sleep(" output_apps/enterprise_hub/modules
grep -rn "poll" output_apps/enterprise_hub/modules
```

| Path:Line | Snippet / Purpose | Queue-Status Poll? | Recommendation |
|---|---|:---:|---|
| `output_apps/enterprise_hub/modules/data_import/migration/bak/restore-runner.ts:67` | `const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));` | **No** | **Leave as is**. Helper function for container readiness probe. |
| `output_apps/enterprise_hub/modules/data_import/migration/bak/restore-runner.ts:94` | `if (!ready) await sleep(2000);` (SQL Server Docker sandbox readiness probe) | **No** | **Leave as is**. Polls SQL Server socket readiness inside a throwaway container before running `HEADERONLY`. Does not touch BullMQ. |
| `output_apps/enterprise_hub/modules/data_import/bulk/bulk-import.runner.ts:185` | `if (Date.now() - lastPoll >= progressIntervalMs()) { lastPoll = Date.now(); const outcome = await controlRequested(); ... }` | **No** | **Leave as is**. Checks Postgres `bulk_jobs` status for user pause/cancel requests during chunked streaming. Does not poll BullMQ. |
| `output_apps/enterprise_hub/modules/data_import/bulk/bulk-import.runner.ts:193` | `if (Date.now() - lastPoll >= progressIntervalMs()) { ... }` | **No** | **Leave as is**. Second check in batch loop for database pause/cancel flag. |
| `output_apps/enterprise_hub/modules/tax_compliance/services/tax-transmission.service.ts:130` | `this.queue.add(MOADIAN_TX_JOB, data, { jobId: ..., delay: ... })` | **No** | **Leave as is**. Schedules a BullMQ delayed job to query the Iranian Tax Organization (Moadian) external HTTP gateway. It uses BullMQ as the scheduler, not polling BullMQ itself. |
| `output_apps/enterprise_hub/modules/tax_compliance/services/moadian.service.ts:457` | `private async schedulePoll(data: MoadianJobData, pollCount: number): Promise<void>` | **No** | **Leave as is**. Equivalent Moadian delayed job inquiry scheduler for external tax authority status. |

---

### 2.3 Grep Command: Sleep & Polling Loops in `ecosystem_core`

```bash
grep -rn "asyncio.sleep\|time.sleep" output_apps/ecosystem_core
grep -rn "poll" output_apps/ecosystem_core
```

| Path:Line | Snippet / Purpose | Queue-Status Poll? | Recommendation |
|---|---|:---:|---|
| `output_apps/ecosystem_core/src/factory/ephemeral_runner.py:1212` | `await asyncio.sleep(delay)` (Container port binding probe) | **No** | **Leave as is**. Polls docker daemon for ephemeral container port binding. |
| `output_apps/ecosystem_core/src/factory/ephemeral_runner.py:1281` | `await asyncio.sleep(1.0)` (Compose up retry backoff) | **No** | **Leave as is**. Transient daemon network race retry delay. |
| `output_apps/ecosystem_core/src/factory/ephemeral_runner.py:1320` | `await asyncio.sleep(1.0)` (Compose build auto-heal retry backoff) | **No** | **Leave as is**. Auto-heal retry backoff for container build. |
| `output_apps/ecosystem_core/src/factory/ephemeral_runner.py:2889` | `await asyncio.sleep(period)` (Garbage collector background loop) | **No** | **Leave as is**. Periodic sweep of stale ephemeral containers. |
| `output_apps/ecosystem_core/src/crawlers/autonomous_crawler_daemon.py:57` | `await asyncio.sleep(0.01)` (Event loop yield during crawl) | **No** | **Leave as is**. Async loop cooperative scheduling yield. |
| `output_apps/ecosystem_core/src/crawlers/live_scraper_daemon.py:52` | `await asyncio.sleep(0.5)` (Scraper pace delay) | **No** | **Leave as is**. Rate-limiting delay between external feed crawls. |
| `output_apps/ecosystem_core/src/crawlers/deep_web_crawler.py:141` | `await asyncio.sleep(0.05)` (Crawl throttle) | **No** | **Leave as is**. Rate-limiting sleep between HTTP requests. |
| `output_apps/ecosystem_core/src/factory/llm_client.py:60` | `time.sleep(1)` (LLM error retry backoff) | **No** | **Leave as is**. HTTP 429/5xx retry backoff for API client. |
| `output_apps/ecosystem_core/src/factory/smartjudge_live_voice.py:481` | `await asyncio.sleep(KEEPALIVE_SECONDS)` (WebSocket keepalive) | **No** | **Leave as is**. Audio stream keepalive ping interval. |
| `output_apps/ecosystem_core/src/factory/research_factory_swarm.py:22` | `await asyncio.sleep(0.8)` (Tool call simulation) | **No** | **Leave as is**. Mock delay for research tool execution. |
| `output_apps/ecosystem_core/src/billing/crypto_payment_service.py:305` | `def poll_once(store, activate_fn, fetch_fn, now)` (Blockchain payment verify) | **No** | **Leave as is**. External crypto blockchain verification cycle run via systemd timer or verification webhook. |

---

## 3. BullMQ Architecture Verification

The backend queues in `output_apps/enterprise_hub/modules` are configured as follows:

1. **`accounting`**: `RECURRING_VOUCHERS_QUEUE` — Consumed via `@Processor(RECURRING_VOUCHERS_QUEUE)` in `recurring-voucher.processor.ts`. Event-driven.
2. **`damages`**: `DAMAGES_QUEUE_NAME` — Consumed via `@Processor(DAMAGES_QUEUE_NAME)` in `damages-queue.processor.ts`. Event-driven.
3. **`tax_compliance`**: `MOADIAN_QUEUE` — Consumed via `@Processor(MOADIAN_QUEUE)` in `moadian.processor.ts`. Event-driven; inquiries use BullMQ delayed jobs (`delay: 15_000`) rather than in-process sleep loops.
4. **`data_import`**:
   - `BULK_QUEUE_NAME` — Consumed via `@Processor(BULK_QUEUE_NAME, { concurrency: 1 })` in `bulk-import.processor.ts`. Event-driven.
   - `PACKAGE_QUEUE_NAME` — Consumed via `@Processor(PACKAGE_QUEUE_NAME)` in `package-import.processor.ts`. Event-driven.
5. **`approvals`**: `APPROVAL_ESCALATION_QUEUE` — Consumed via `@Processor(APPROVAL_ESCALATION_QUEUE)` in `approval-escalation.processor.ts`. Event-driven.
6. **`invoicing`**: `SUITE_EVENTS_QUEUE` — Consumed via `@Processor(SUITE_EVENTS_QUEUE)` in `suite-events.processor.ts`. Event-driven.

### Evaluation of `QueueEvents` ('completed' / 'failed')

`QueueEvents` from `bullmq` is indicated when an application service submits a job to BullMQ and needs to await completion across processes without blocking a worker thread (e.g. `await job.waitUntilFinished(queueEvents)`).

In Roxira's architecture:
- Job producers enqueue work asynchronously (`queue.add(...)`) and return HTTP 202 / job IDs immediately to the caller.
- Frontend clients poll status via standard REST endpoints (`GET /data-import/bulk/jobs/:id` or WebSocket progress streams).
- Workers update Postgres database entities (`status: 'ready'`, `'failed'`, `'completed'`) directly upon completion.
- No backend NestJS service blocks on `queue.getJob()` or uses a `setInterval` loop to await job completion.

Therefore, introducing `QueueEvents` listeners to replace timer loops is **not required**, because no timer loops exist around BullMQ queue status. All existing timer usages serve distinct, legitimate domain functions (container health probes, disk sweepers, and external rate limiters).
