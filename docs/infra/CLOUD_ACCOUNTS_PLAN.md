# Cloud accounts plan: Qdrant Cloud, Modal, Neon, Zilliz (2026-10-21)

## خلاصه (فارسی)

مالک چهار حساب ابری دارد. اصل: سرور srv1 و Qdrant محلی همچنان منبع اصلی‌اند؛ این حساب‌ها فقط
**پشتیبان یا شتاب‌دهندهٔ اختیاری** هستند و تا وقتی متغیرشان در `.env` سرور نباشد هیچ کاری نمی‌کنند.

| حساب | الان | بعداً | عمداً استفاده نمی‌کنیم |
|---|---|---|---|
| Qdrant Cloud | کپی داغ فقط‌خواندنی از کالکشن قوانین (شبانه ۰۳:۱۰ UTC) و failover وقتی Qdrant محلی قطع است | اگر RAM سرور کم آمد، جست‌وجوی برداری را کاملاً به ابر ببریم | منبع اصلی داده؛ نوشتن اپ روی ابر؛ داده‌های مشتری (فقط قوانین عمومی) |
| Modal | ساخت دسته‌ای embedding کورپوس (`EMBED_BACKEND=modal`) با سقف هزینه | بازسازی v4/v5، OCR/STT دسته‌ای | سرو ترافیک زندهٔ کاربر ایرانی (تأخیر، تحریم، ریسک قطع) |
| Neon | همین الان: بک‌آپ بیرونی شبانه (#758) | میزبان Postgres آزمایشی برای PR preview | دیتابیس اصلی تولید (تأخیر از ایران، ریسک ToS/تحریم) |
| Zilliz | فعلاً هیچ | آزمایش مقایسه‌ای (benchmark) در صورت نیاز | وابستگی دوم برداری؛ دو سیستم برای نگهداری زیاد است |

نکتهٔ حقوقی/ریسک: سرویس‌های آمریکایی ممکن است حساب کاربران یا IP ایرانی را مسدود کنند یا شرایط
استفاده اجازه ندهد. بنابراین مسیر کاربر نهایی ایرانی هرگز به این سرویس‌ها وابسته نمی‌شود؛ فقط
کارهای پشت‌صحنه (بک‌آپ، ساخت کورپوس) و سرور خارج از ایران آن‌ها را صدا می‌زند. استفادهٔ جدی و
تجاری از آن‌ها برای مسیر شرکت مالزیایی نگه داشته می‌شود.

مراحل مالک: بخش «Owner steps» پایین، همه با `scripts/ops/set_server_env.sh NAME`.

## Principles

1. Local-first: local Qdrant on srv1 stays the source of truth. Cloud accounts are optional
   replicas or batch helpers, all env-gated and inert until the variable exists.
2. Law corpus only (public data). No customer data, no secrets, no PII goes to any of these.
3. Iranian end users never depend on a US service on the request path (latency, sanctions, ToS,
   account suspension risk). The app server is outside Iran; the cloud calls are server-to-server.
4. Free first (AGENTS.md section 4): everything below fits the free tiers; each integration has a hard cap.

## Qdrant Cloud

**Now.** Hot read-only replica of the active law collection(s).
- `scripts/infra/qdrant_replica.py`: nightly (03:10 UTC) snapshot of the local collection(s), stream
  upload to Qdrant Cloud (`/snapshots/upload?priority=snapshot`), then verify exact point counts and
  that top-5 ids of 20 sample vectors are identical on both sides. Dry-run by default.
- Units: `scripts/infra/roxira-qdrant-replica.service` / `.timer`, installer
  `scripts/infra/install_qdrant_replica.sh` (dry-run default, `--apply`). The job runs in a disposable
  `python:3.12-slim` container sharing Qdrant's network namespace, 256 MB cap, only the needed env
  names passed (not the whole `.env`).
- App failover: `legal_graph/qdrant_cloud.py` + `lightrag_engine._qdrant_targets()`. Local hosts are
  tried first exactly as before; only when every local host fails to connect/time out is the cloud
  replica tried (read calls only: search, scroll, collection info). One warning per minute, the URL and
  key are never logged. Cloud URL must be https (the key is sent as the `api-key` header).
- Collections: `QDRANT_REPLICA_COLLECTIONS` (comma list), default `LIGHTRAG_QDRANT_COLLECTION`, else
  `iran_laws_v3`. Set it explicitly to the collection `LIGHTRAG_QDRANT_COLLECTION` points to in prod.
- Limits to check before enabling: free cluster is ~1 GB RAM / 4 GB disk; a 1024-dim collection of
  ~6k points is small, but run `--dry-run` first and compare to the cluster quota. The cloud Qdrant
  version must be >= the local one (snapshots are version-sensitive); if the upload is refused, upgrade
  the cloud cluster or pin local.
- Failover caveat: if the replica is up to 24 h old, a failed-over answer may miss newly built laws.
  Acceptable for an emergency read path; the snapshot job runs after each corpus switch (run
  `systemctl start roxira-qdrant-replica.service`).

**Later.** If RAM on srv1 becomes the constraint, serve vector search from the cloud permanently
(needs a latency measurement from srv1 first) and drop the local collection memory.

**Deliberately not.** Writing from the app to the cloud; storing tenant/customer vectors there; using
it as the only copy.

## Modal

**Now.** Batch embeddings for corpus builds (`scripts/infra/modal_embed.py`), because srv1's TEI
(bge-m3 on ARM CPU, 1.2 GB RAM, `--max-concurrent-requests 8`) is slow and competes with live chat.
- Opt-in: `EMBED_BACKEND=modal bash scripts/legal/build_v4_on_server.sh` (default stays TEI).
  `scripts/legal/ingest_pipeline.py::default_embed` dispatches on the variable. The build script passes
  the tokens by name into the build container and installs the Modal SDK into `/work/pydeps` (not into
  the image).
- Same vectors as TEI: bge-m3, dense, 1024, L2-normalised, fp32; parity gate in
  `docs/infra/MODAL_EMBED_PARITY.md` (cosine >= 0.999 on 50 articles) before the first real use.
- Cost guard: `MODAL_EMBED_MAX_ROWS` (default 20000, cumulative per process), one GPU container max
  (`max_containers=1`), 120 s idle scale-down, `estimate` / dry-run before `--apply`. A T4 run of the
  full ~6k-row corpus is estimated at a few cents against the $30/month credit; check current prices on
  modal.com/pricing and set `MODAL_GPU_USD_PER_HOUR` if they differ.
- Caveat: the SDK API was written against the documented Modal 1.x interface (`modal.App`,
  `@app.cls`, `scaledown_window`, `max_containers`) but was not run here (no account/network in the
  build sandbox). Run `estimate` and the `parity` command once before trusting it.

**Later.** Re-embedding after a model change, batch OCR/STT, nightly eval jobs.

**Deliberately not.** Serving live user queries (cold starts, US dependency, sanctions risk); sending
anything except public law text; running without the row cap.

## Neon

**Now.** Already used for the nightly off-site backup restore test (#758, `NEON_BACKUP_URL`).
**Later.** Throw-away Postgres branches for PR previews and migration rehearsals (AGENTS.md: migrations
land only via reviewed PRs, so rehearsing on a Neon branch is safe).
**Deliberately not.** Primary production DB: latency from the srv1 app is acceptable but from Iran it is
not our path anyway; the real risk is dependence on a US vendor that can suspend an account, and we
would hold customer data there. Keep for the Malaysian-company track.

## Zilliz

**Now.** Nothing. **Later.** Optional benchmark of recall/latency against Qdrant on the same golden
sets (`scripts/eval_chat_golden.py --retrieval-only`) if we ever question Qdrant.
**Deliberately not.** A second production vector database: two systems to keep in sync for no gain, and
the same US-vendor risk as above. Revisit with the Malaysian company.

## Owner steps (exact)

All commands run from the repo on the Mac; values are typed at the hidden prompt, never on a command line.

Qdrant Cloud:
1. Create a cluster (region EU, same or newer Qdrant version as local; check
   `docker exec roxira_qdrant_prod qdrant --version` or the dashboard) and an API key.
2. `bash scripts/ops/set_server_env.sh QDRANT_CLOUD_URL` (https://<cluster>.<region>.cloud.qdrant.io:6333)
3. `bash scripts/ops/set_server_env.sh QDRANT_CLOUD_API_KEY`
4. Optional: `bash scripts/ops/set_server_env.sh QDRANT_REPLICA_COLLECTIONS` (e.g. `iran_laws_v3`).
5. On srv1: `bash scripts/infra/install_qdrant_replica.sh` (dry-run), then `--apply`; first run:
   `systemctl start roxira-qdrant-replica.service && journalctl -u roxira-qdrant-replica -n 30`
   (expect a JSON line with `"ok": true`).
6. App failover needs the app container to see the two variables: `docker-compose.prod.yml` now
   passes them; takes effect at the next owner-approved app restart.

Modal:
1. In Modal, create a token (Settings > API tokens).
2. `bash scripts/ops/set_server_env.sh MODAL_TOKEN_ID` and `... MODAL_TOKEN_SECRET`
3. Parity check, then build: see `docs/infra/MODAL_EMBED_PARITY.md`; build with
   `EMBED_BACKEND=modal MODAL_EMBED_MAX_ROWS=8000 bash scripts/legal/build_v4_on_server.sh --dry-run` first.
   (The build script reads the tokens from its shell environment; export them for that session from
   the server `.env`, do not paste them into the terminal history.)

Neon: already configured via `NEON_BACKUP_URL` (#758). Nothing new.

Zilliz: nothing to set. Do not create keys until needed.
