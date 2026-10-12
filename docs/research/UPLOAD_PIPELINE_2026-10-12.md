# Case-file upload and document-understanding pipeline (design, 2026-10-12)

Status: research and design only. No production change. Scope: Smart Judge chat (ghazihoushmand.ir).
Evidence paths are relative to the repo root. Line numbers refer to this worktree (branch `fix/vision-ocr-reasoning`).

## 0. Executive summary

- Root cause of "heavy files never finish": OCR runs **inside the HTTP request**. At about 8 s per scanned page (measured, section 1.6), a 20-page scan needs about 55 s of pure OCR with concurrency 3, and a 50-page scan blows through Cloudflare's fixed **100 s** origin timeout (HTTP 524). The frontend then shows a spinner for up to 240 s x 2 attempts, which matches "I waited and removed them".
- Fix is architectural, not a tuning knob: **upload fast, process in a background job, show per-file progress, let the user keep chatting**.
- Recommended stack (no new infrastructure): FastAPI + the existing Redis + **arq** worker (or a FastAPI-launched worker process), chunked/resumable upload only as P2, client-side image downscale/HEIC to JPEG in P0, per-page OCR with Gemini 3.8 Flash (already registered, paid, `data_collection: deny`), Tesseract `fas` fallback, Markdown with page anchors stored per page, then chunked into the per-chat retrieval index.
- Cost: about USD 0.3 to 0.8 per 100 scanned pages with Gemini Flash; realistic early-stage total about USD 5 to 40 per month (section 6). No GPU, no new server.

## 1. Diagnosis from code

### 1.1 Synchronous OCR inside the request (primary cause)
- `output_apps/generated_modules/smartjudge/smartjudge_module.py:2823-2824`: `async with _casefile_sem(): body = await _case_files.process_upload(...)`. The HTTP response is only sent after OCR, optional summarisation and storage finish.
- `case_files.py:679-684` (`_process_reserved`): `asyncio.wait_for(extract(...), timeout=PROCESS_TIMEOUT_S)`; `PROCESS_TIMEOUT_S` = 150 s (`case_files.py:72`). That is already larger than Cloudflare's 100 s.
- `case_files.py:411-422` (`_ocr_images`): one vision call per page, concurrency 3. Each call can itself wait up to 90 s (`httpx.Timeout(90.0)`, `case_files.py:~248`) and loops over models x keys, so one slow provider burns the budget.
- `case_files.py:~478-495` (`_pdf_open_and_extract`): every scanned page is rendered to **PNG and JPEG** (up to 2400 px) and **all kept in memory** until OCR ends; a 30-page scan is roughly 100 to 250 MB of buffers per file, two files at once.
- After OCR, a long text (> 6000 chars) triggers a second LLM stage (`summarize`, `case_files.py:~710`, up to 60 s) in the same request.

### 1.2 Cloudflare 524
- Cloudflare (Free/Pro/Business) closes the connection if the origin sends no response header within about **100 s**; only Enterprise can raise it. Source: Cloudflare community and docs (links in section 8).
- `output_apps/nginx_config/nginx.conf:227` sets `proxy_read_timeout 300s` and `production_bundle/nginx/nginx.conf:10` too, so nginx waits happily while Cloudflare has already given up. The browser sees an HTML 524 page, not JSON.
- In `case-files-client.ts:78-83` a non-JSON 524 body falls through `messageFor()` to the generic "upload failed" text (`case-files-client.ts:56-64`), and because `retryOnGatewayStatus: false` (line 85) there is no retry. But the origin keeps working and still reserves quota and stores a record the user never gets (orphan `casefile:<uuid>` for 7 days).

### 1.3 Frontend: no progress, long timeout, hidden retry cost
- `case-files-client.ts:20`: `CASE_FILE_TIMEOUT_MS = 240_000` with `maxAttempts: 2` (line 84): a hung upload can spin for **up to 8 minutes** before an error, and the retry re-uploads the whole file.
- `case-files-client.ts:6-7` comment confirms `fetch` has no upload progress; the UI shows only "در حال بارگذاری…" (`chat-shell.tsx:1190-1192`) for both upload and OCR. Users cannot tell "sending" from "reading" from "stuck".
- Send is disabled while anything is uploading (`chat-shell.tsx:808`, `1366`): the user cannot keep chatting during a slow file. Strongly raises the feeling that the app is hung.
- Up to 5 files start **in parallel** (`chat-shell.tsx:486-503`, `void startUpload`). On a phone uplink this splits bandwidth, so every file is slower, and server side the semaphore (`smartjudge_module.py:2766-2771`, 2 slots) makes files 3-5 wait **inside the request**; that wait counts against the 100 s clock.

### 1.4 Size and page limits are discovered late
- 15 MB limit (`case_files.py:62`, client `case-files-client.ts:15,45`). A 12-megapixel iPhone photo is 2 to 5 MB (JPEG) but a scanner-app PDF or HEIC "Live/ProRAW" can exceed 15 MB. The limit is only checked from the file size, and the message is Persian text telling the user to pick a smaller file, with no way to shrink it.
- `MAX_PAGES = 30` (`case_files.py:63`, enforced at line ~473) is checked **after** the full upload; MSG_TOO_MANY_PAGES tells the user to split manually. A 60-page PDF under 15 MB uploads completely and is then rejected.
- Per-call 4000 `max_tokens` (`case_files.py:~349`) can truncate dense pages silently.

### 1.5 iOS Safari behaviour
- The file input `accept` (`case-files-client.ts:21`) lists `.heic,.heif` explicitly. Per WebKit bug reports, Safari's automatic HEIC-to-JPEG transcoding depends on the shape of the `accept` list and has changed across iOS versions (links in section 8). Result: the server may receive raw HEIC. It then must be decoded server-side with pillow-heif (installed in `Dockerfile.prod:25`), costing CPU and bytes; and `MSG_HEIC_UNSUPPORTED` triggers if the library fails (`case_files.py:~380`).
- iOS suspends page networking when the tab/app is backgrounded or the screen locks. A plain `fetch` POST of a big body is simply killed (the user switches to the Photos app to pick another file, or the phone sleeps). `fetchWithRetry` (`judge-chat-client.ts:312-355`) waits for visibility and re-sends **the whole body from zero**, so on a weak mobile link the upload may never complete. Chunked/resumable upload (P2) is the proper fix; for now smaller files (client-side compression) reduce the exposure window.
- `<input capture="environment">` (`chat-shell.tsx:1252-1253`) gives full-resolution camera JPEGs (up to 12 to 48 MP). `MAX_IMAGE_PIXELS = 60M` is fine but nothing downsizes before upload.

### 1.6 Other findings
- `output_apps/nginx_config/nginx.conf:4,214-216`: `limit_req zone=auth` (`5r/m`, `burst=5`, `nodelay`, status 429) is applied to the **whole** `/api/v1/apps/judge/` location. If this file reflects production, 5 parallel uploads plus chat requests from one IP (shared carrier NAT in Iran/mobile) can hit 429 on any request. Needs a read-only check on the server (`nginx -T`), not changed here.
- `proxy_buffering off` (line 228) does not disable request buffering; nginx still buffers the whole body to disk before proxying, so uploads are not streamed to the app.
- Quota is reserved before OCR and released on any failure (`case_files.py:665-676`); a client abort that arrives after 524 can still finish server side and consume quota.

### 1.7 Measurements (synthetic, USD under 0.02 total)
Method: one synthetic Persian-like page rendered at 1700 x 2400 px, JPEG q85 (355 KB), the production vision prompt shape, `google/gemini-3.8-flash`, `reasoning: {effort: minimal}`, `provider.data_collection: deny`, via OpenRouter, 3 sequential calls from the Mac. The text on the image is synthetic and unshaped, so **accuracy was not measured**, only latency/cost.

| Call | Latency | Prompt tok | Completion tok | Cost |
|---|---|---|---|---|
| 1 | 7.1 s | 1120 | 635 | 0.0032 |
| 2 | 6.4 s | 1120 | 641 | 0.0032 |
| 3 | 10.1 s | 1120 | 1399 | 0.0061 |

- Per page: **6 to 10 s**, USD **0.003 to 0.006** (so USD 0.3 to 0.6 per 100 pages for ~1700 to 2200 characters per page; dense real pages will be higher, plan USD 0.8 per 100).
- Timeline with current code (concurrency 3, 8 s/page): 12 pages about 32 s, 25 pages about 67 s plus render, **40 pages about 107 s -> 524**, 100 pages about 270 s. The practical ceiling today is about 25 scanned pages, one file at a time, which is below the stated MAX_PAGES of 30 and far below the 20-100 page goal.
- Local Tesseract `fas` runs in under 1 s per synthetic page on an M-series Mac (real, noisy pages are 2 to 6 s per page on 1 ARM core); fine as fallback but Persian handwriting/stamps/phone shadows are weak (no measured benchmark found; treat as lower quality than Gemini).

## 2. Research: building blocks (2026)

### 2.1 Upload transport
| Option | Fit | Notes |
|---|---|---|
| Plain multipart + fast 202 | P0/P1 | Simple. Combine with client compression so most files are under 3 MB. Use `XMLHttpRequest` (or `fetch` + `ReadableStream` is not supported for upload progress in Safari) to get `upload.onprogress`. |
| tus protocol (tusd or `tus-js-client` + FastAPI tus endpoint) | P2 | Resumable via HEAD offset; works well in browsers after the tab returns from background. Native iOS background sessions are outside web scope. tusd is a Go binary (MIT) and can run as a sidecar writing to local disk with a post-finish hook. |
| Uppy (with tus plugin) | P2 UI | Heavy UI; the chat has its own chips, so use only `tus-js-client`. |
| S3-style multipart to local MinIO | Not recommended | Extra service; no CDN benefit at this scale. |
| Cloudflare 100 MB request cap | Informational | Not our constraint after P0 (limit 25 MB per file). Chunks of 5 MB under tus stay far below it. |

iOS reality: a web page cannot upload in the background. Resumability helps only when the user returns to the tab (HEAD offset, continue). Native TUSKit docs say the same (schedule uploads in the foreground). So the UX must say "keep this screen open until the bar completes" for the transfer phase only, and "you can keep chatting" for the processing phase.

### 2.2 Client-side preparation (P0)
- Images: decode with `createImageBitmap(file, {imageOrientation: "from-image"})`, draw to canvas with max side 2400 px (matches server `OCR_MAX_SIDE_PX`), `canvas.toBlob("image/jpeg", 0.82)`. Result about 300 to 900 KB instead of 3 to 12 MB, and EXIF/GPS is stripped for free.
- HEIC: current iOS Safari can decode HEIC natively through `<img>`/`createImageBitmap`, so the same canvas path converts it; use `heic2any`/libheif-js (WASM, lazy-loaded) only as a fallback for Chrome desktop. Keep server pillow-heif as last resort.
- Also change `accept` so that iOS converts: list MIME types (`image/jpeg,image/png,image/webp,application/pdf,...`) and test on a real iPhone, since behaviour changed between iOS 17 and 18+ (section 8).
- PDFs: do not rasterise in the browser for P0; send as is. P1: if a PDF is larger than 10 MB and `pdf-lib`/pdf.js is cheap to load, optionally render pages to JPEG client side. Usually unnecessary because the server splits pages.
- Show size before/after ("2.1 MB -> 0.5 MB") so users see why it is quick.

### 2.3 PDF page splitting and per-page jobs
- PyMuPDF (already in `Dockerfile.prod:21`; AGPL/commercial, we already use it) opens the PDF once, extracts the text layer per page, and renders only pages with fewer than 40 chars (existing heuristic, `OCR_PAGE_MIN_CHARS`). Render lazily per page at 150 to 200 DPI to JPEG q80 (roughly 150 to 400 KB), never keep all pages in memory.
- Each page becomes one queue item or one coroutine under a semaphore; results are written to Redis as they arrive (`page:<n>`), which gives progress and partial results for free.
- Pre-check (cheap, before OCR): page count, encrypted flag, JavaScript/embedded files/launch actions (reject or strip), declared image dimensions.

### 2.4 Async job queue with progress
| Option | Verdict |
|---|---|
| FastAPI `BackgroundTasks` | OK as P0 stopgap, but dies with the worker/redeploy, no retry, no isolation from the API process. |
| **arq** (asyncio + Redis) | **Recommended.** Our code is async, the I/O is mostly HTTP to vision models, only Redis needed. Retries, timeouts, cron cleanup built in. |
| RQ | Simple but synchronous; per-page HTTP concurrency would need threads. |
| Dramatiq / Celery | More features, more weight; not needed. |

Progress channel: worker writes `job:<id>` hash in Redis (`state`, `pages_done`, `pages_total`, `stage`, `error`). Client polls `GET /case-files/{id}/status` every 1.5 to 3 s (works through Cloudflare and iOS without trouble). SSE `GET /case-files/{id}/events` is a nice-to-have in P2; Cloudflare allows long-lived streaming if bytes keep flowing (heartbeat every 15 s), but polling is more robust on mobile and needs nothing new. The owner's architecture document (section 7) itself proposes SSE for the chat stream, so reuse that channel later.

### 2.5 OCR and conversion options
Persian quality is the decisive factor; there is no trustworthy independent Persian benchmark for these tools, so ratings below are explicit **estimates** and the plan includes a 30-page gold-set bake-off before any switch.

| Option | Persian quality (estimate) | Cost / 100 pages | ARM CPU server | Licence | Privacy |
|---|---|---|---|---|---|
| **Gemini 3.8 Flash vision** (current, `config/models.yaml` role `vision`) | Good to very good on print and photos; handles layout, stamps, tables by prompt | USD 0.3 to 0.8 (measured section 1.7) | n/a (API) | Commercial API | Paid tier, `data_collection: deny`; contractually not for training on paid routes, still a third party: disclose |
| Mistral OCR (API, OCR 4 per secondary sources) | Unknown/unverified for Persian; docs list Farsi in language models, OCR table not confirmed | USD 0.2 to 0.5 (reported 2 to 5 per 1000 pages) | n/a | Commercial API | EU provider; zero-retention option to confirm in contract |
| Tesseract 5 `fas` (installed, `Dockerfile.prod:50-52`) | Fair on clean print, poor on photos/shadows/stamps/handwriting; digit and ZWNJ errors | 0 (CPU 2 to 6 s/page) | Yes, trivial | Apache-2.0 | Fully local |
| PaddleOCR PP-OCRv5 (via RapidOCR/ONNX) | Arabic-script recogniser (covers Persian) exists; line-level, no layout; decent on print, untested for legal scans | 0 (CPU about 1 to 3 s/page) | ONNX Runtime works on aarch64 | Apache-2.0 | Fully local |
| Docling (IBM) | Layout/table pipeline plus pluggable OCR (RapidOCR "arabic", Tesseract); Persian only as good as the OCR plugin | 0 (CPU, heavy models, about 5 to 20 s/page on ARM, 2 to 4 GB RAM) | Yes (PyTorch CPU) | MIT | Local |
| MarkItDown (Microsoft) | Converts DOCX/XLSX/PPTX/HTML to Markdown; no real OCR | 0 | Yes | MIT | Local |
| Marker / Surya | Surya advertises 90+ languages, but a public Arabic benchmark shows weak recognition; no Persian figure | 0 on CPU but slow (VLM, llama.cpp) | Unconfirmed on Linux ARM | Code GPL/Apache depending on version; **weights restricted** (free only for small startups, conflicting statements) | Local; licence risk |

Conclusion: keep **Gemini Flash as primary** (best Persian quality per dollar, no ops burden), **Tesseract fas as automatic fallback** (already wired), and add **PP-OCRv5 Arabic via RapidOCR as an optional local engine** only if the bake-off shows it is within 5 CER points of Gemini on our gold set, because that would remove third-party exposure for the most sensitive files (a "private mode"). Docling is attractive for tables but heavy; defer. Use **python-docx** (already used) or MarkItDown for DOCX/XLSX, not OCR.

Privacy rules that must hold (AGENTS.md section 4): never a `:free` model, always `provider.data_collection=deny`, no key in frontend, no customer text in logs. The existing `_openrouter_chat` already does this; keep it.

### 2.6 Structured output and RAG
- Store per page: `{page, source: "text-layer"|"ocr:gemini"|"ocr:tesseract", text, confidence_flag}`; render Markdown as `<!-- page:12 -->` anchors followed by text. Prefer asking the model for light Markdown (headings, tables as pipes) instead of plain text; keep "do not guess, mark [ناخوانا]" (already in `_VISION_PROMPT`).
- Normalise Persian (Arabic ya/kaf to Persian, digits to one set for search while keeping the original), strip repeated headers/footers when detected on > 50 % of pages.
- Chunk by page then by about 800 to 1200 characters with 15 % overlap, keep `{file_id, page, chunk_idx}` metadata. Per-chat retrieval: today the prompt takes excerpts plus a summary (`case_files.py:764-814`, `PROMPT_TOTAL_CHARS` 12 000). With a 100-page file that is about 5 % of content. Move to retrieval: embed chunks (existing sentence-transformers or Qdrant, port 6333) into a **per-chat collection** keyed by `conversation_id`, with tenant/owner column, and retrieve top-k per question with page citations; keep the summary as a standing "case brief". Vectors are deleted with the file or after retention.
- The owner's architecture note (section 7) suggests PostgreSQL + pgvector; Qdrant is already running and reserved, either works. Decide in P2.

## 3. Recommended architecture

```
iPhone/browser
  1. pick files -> client: validate, downscale/convert images (canvas), size/page pre-check
  2. POST /case-files (XHR, progress events)  ->  202 {file_id, state:"queued"}   (seconds)
        nginx/Cloudflare: only the byte transfer is on the clock
  3. FastAPI: sniff type, size, zip/PDF safety checks, write raw to private disk (tmpfs/volume),
     reserve quota, enqueue arq job
  4. arq worker (same image, separate process, concurrency 2 files x 3 pages):
        PDF/DOCX/TXT/image -> per-page text layer or OCR (Gemini -> Tesseract fallback)
        write page results + progress to Redis, then Markdown + chunks + embeddings
        delete raw file at the end (or on failure)
  5. client polls GET /case-files/{id}/status every 2 s (SSE later) -> progress chip
  6. chat sends case_file_ids as today; backend retrieves top-k chunks with page citations
```

Key properties:
- The upload request returns in seconds, so Cloudflare 524 disappears by construction.
- The user can keep chatting. If they send a question while a file is still processing, the backend answers with the pages that are ready and says so ("file still being read: 14 of 40 pages"), or the UI offers to auto-send when ready.
- Retries are per page, not per file; a restart of the worker resumes from the Redis state.
- Raw bytes live only on a private volume and are deleted when processing ends; only text is retained 7 days (current policy), and the user can delete it any time (already implemented).

## 4. Phases

### P0: quick wins (about 1 day, no new infrastructure)
1. **Decouple response from OCR** with the smallest change: `POST /case-files` validates, stores raw bytes to a temp file, returns `202 {file_id, state:"processing"}`, and runs `process_upload` in an `asyncio.create_task` (or FastAPI BackgroundTasks) writing `casefile:<id>` state (`processing|ready|error`, `pages_done`, `pages_total`). New `GET /case-files/{id}/status`. Frontend polls every 2 s. Caveat: tasks die on restart; acceptable for P0, arq in P1.
2. **Per-page progress** in the OCR loop (`_ocr_images`): update `pages_done` in Redis after each page. Show "در حال خواندن صفحه ۱۴ از ۴۰" in the chip.
3. **Frontend**: switch the uploader to `XMLHttpRequest` for `upload.onprogress` (percent bar), timeout 60 s for the transfer only, no whole-file retry on timeout (retry from the chip), upload files **sequentially** (max 2 at a time), and do **not** disable the send button while processing (send with ready files; show a notice for pending ones).
4. **Client-side image compression**: canvas downscale to 2400 px, JPEG 0.82, EXIF stripped; HEIC converted by Safari decode path; fix `accept` list; keep the camera input.
5. **Raise limits sensibly**: 25 MB per file, `MAX_PAGES` 100 (OCR cost is the real limit), per-chat total 150 pages, 5 files. Reject on page count immediately after upload with a precise message (no manual-split instruction when automatic is possible).
6. **Memory**: render each scanned page lazily and drop it after OCR (no all-pages list); JPEG only for the vision engine, PNG only if Tesseract is actually used.
7. **Fix messages**: distinguish "uploading", "reading page x/y", "failed (retry)", and map HTML/524/413/429 responses to a clear Persian text. Remove the 240 s x 2 behaviour.
8. Read-only check of the production nginx `limit_req` zone on `/api/v1/apps/judge/` (section 1.6) and of Cloudflare plan (to confirm the 100 s and 100 MB assumptions); report, do not change without owner approval.

Estimated P0 effort: backend 4 h, frontend 4 h, tests 1 to 2 h. Extra monthly cost: none.

### P1: durable queue and quality (about 3 to 5 days)
- Replace `create_task` with **arq** worker (new container `smartjudge-worker`, same image; Redis already present; check `ss -tulnp` for any new port, none needed). Job retries (3), per-page timeout 60 s, global job timeout 20 min, dead-letter state with a user-visible error.
- Per-page results in Redis with TTL and the Markdown with `<!-- page:n -->` anchors; progress endpoint reads them.
- Page-level concurrency 3 per file, 2 files per worker, global OCR rate limit per user (e.g. 100 pages per day free tier, 500 VIP) in place of the file-count quota, so cost is bounded by pages.
- Better OCR prompt returning Markdown with tables; `max_tokens` 8000; detect truncated pages and re-run with smaller crop (split page in two halves).
- Image pre-processing for phone photos: auto-rotate by EXIF (already), deskew and shadow removal (OpenCV adaptive threshold) only when OCR confidence flag fails, then retry once.
- DOCX/XLSX via python-docx/openpyxl (tables to Markdown), ZIP of allowed files (max 20 entries, 80 MB uncompressed, no nesting).
- Security hardening (section 5) completed.

### P2: scale and UX polish (1 to 2 weeks)
- **tus resumable upload** (tusd sidecar or Python tus endpoint) for files > 8 MB, 5 MB chunks, resume after iOS suspends; progress bar survives backgrounding.
- **Per-chat vector index** (Qdrant collection per conversation or payload filter, owner column enforced in the NestJS/FastAPI repository layer) with citations to page numbers; "show source page" thumbnail optional.
- SSE status/event stream, push into the chat ("your file is ready") and automatic follow-up question.
- Optional local OCR "private mode" with PP-OCRv5 Arabic (RapidOCR/ONNX) if the bake-off supports it; Docling only for table-heavy documents.
- Gold-set bake-off script: 30 synthetic and consented real pages, CER/WER, per-engine cost and time; add result to `docs/research/`.

## 5. Limits, formats, UX copy

| Item | Limit |
|---|---|
| File size | 25 MB per file after client compression (images are normally < 1 MB); 80 MB per chat; Cloudflare 100 MB cap is never approached |
| Pages | 100 per PDF, 150 per chat (OCR cost bound); larger PDFs: ask to split or process first 100 with a notice |
| Files per chat | 5 (unchanged); 2 concurrently processed per user |
| Formats | PDF, JPG, PNG, WebP, HEIC/HEIF (converted client side), DOCX, TXT; P1: XLSX, ZIP (of those); not: DOC (legacy), RAR, executables |
| Retention | 7 days for text; raw bytes deleted when processing ends; user delete button immediate |

UX:
- Chip states: "در حال ارسال ۴۵٪" (bar) -> "در حال خواندن صفحه ۱۴ از ۴۰" -> "آماده · ۴۰ صفحه" or "ناموفق · تلاش مجدد".
- After 100 % transfer: "ارسال کامل شد؛ می‌توانید گفتگو را ادامه دهید، پردازش در پس‌زمینه انجام می‌شود."
- If the user asks while processing: answer from ready pages and say how many are pending; never block the composer.
- Failure text names the cause (unreadable photo, password-protected PDF, too many pages) and the action (retake, remove password, split).
- Mobile tips under the camera button: flat surface, even light, one page per photo; the app shows a blur/darkness warning from a cheap client-side check (Laplacian variance on a 256 px canvas).

Security:
- Sniff by magic bytes (exists, `case_files.py:131-150`), ignore client MIME/extension; re-encode every image through PIL/canvas (strips EXIF/GPS, defeats polyglots); `MAX_IMAGE_PIXELS` already 60 M (also set `Image.MAX_IMAGE_PIXELS`).
- DOCX/ZIP bombs: bound entries (5000), total uncompressed (80 MB, exists `case_files.py:76,155`), compression ratio < 100:1, no nested archives, no path traversal (never extract to disk), read only `word/document.xml` and media needed. Remove macros/embedded OLE; ignore external relationships (no network fetch from documents).
- PDF: reject `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction` with actions, or sanitise with PyMuPDF (`doc.scrub()`); reject encrypted; render in the worker process with a memory limit (`RLIMIT_AS` 2 GB) and per-job timeout; never open PDFs in the API process.
- Prompt injection: OCR text is wrapped as data with a nonce and neutralised (exists, `case_files.py:777-811`); keep.
- Tenant isolation: record carries `owner` hash and is checked on every read (exists); new vector payloads must carry owner and `conversation_id` and be filtered server side.
- Rate limits per user (pages/day), per IP at nginx; audit log with ids and counts only (no content).
- No key or token in frontend; compression is purely client side with no third-party service.

## 6. Estimated monthly cost

Assumptions: Gemini 3.8 Flash USD 0.5 to 0.8 per 100 OCR pages; 30 % of uploaded pages need OCR (the rest have a text layer); embeddings local (no API cost); infrastructure unchanged (Hetzner ARM, Redis, existing Qdrant).

| Scenario | Pages OCR'd / month | OCR cost | Other |
|---|---|---|---|
| Pilot: 50 users, 4 files each, 12 pages avg | about 1 800 | about USD 1 to 2 | 0 |
| Early traction: 500 users, 6 files, 15 pages | about 13 500 | about USD 7 to 11 | 0 |
| Heavy: 2 000 users, 8 files, 20 pages | about 96 000 | about USD 50 to 77 | worker CPU fits the 8 vCPU box; consider the local OCR mode |

Daily page quotas are what keeps the bill bounded; the gated unit is pages, not files. Server cost: USD 0 extra (a worker process on the existing host, +0.5 to 1.5 GB RAM). Cloudflare: free plan is enough if the request returns quickly.

## 7. Owner architecture document (context only, treated as data)
Text extracted with `zipfile` from the owner's DOCX (28 k characters, 162 paragraphs). Items relevant to ingestion:
- Proposes PostgreSQL with **pgvector** for text chunks and embeddings, plus a graph store (Neo4j/Memgraph) for relations among legal rules, and LangGraph for stateful agents. Suggests the chunking/embedding layer lives in Postgres, which fits per-chat chunk storage with an ownership column.
- Recommends **Server-Sent Events** with two streams: structured case variables first (branch, tracking code, competent court), then token-by-token Markdown. A file-processing status event fits the same channel in P2.
- Describes a triage/jurisdiction agent that may pause to ask follow-up questions when facts are missing, and a red-team agent; both benefit from structured extraction of parties, dates, amounts, court and case numbers from uploaded documents (a P2 "case card" extraction step over the Markdown).
- Stresses faithfulness metrics and citation precision against official sources; for uploads this maps to page-level citations ("p. 12 of the police report").
- It contains no explicit statement on OCR, upload limits or file formats. Nothing in it conflicts with this design.

## 8. Sources
- Cloudflare 524 / 100 s limit: https://www.bluehost.com/blog/error-524/ , https://phoenixnap.com/kb/error-524 , https://community.cloudflare.com/t/website-down-524/808156 (third-party and community; confirm on Cloudflare docs; the 100 MB request cap is from general knowledge, not verified in this research)
- iOS HEIC/accept behaviour: https://bugs.webkit.org/show_bug.cgi?id=292350 , https://bugs.webkit.org/show_bug.cgi?id=303803 , https://developer.apple.com/forums/thread/743049
- tus on iOS constraints: https://github.com/tus/TUSKit/issues/193 , https://developer.apple.com/forums/thread/818379
- Queue comparison (secondary): https://www.pistack.xyz/posts/celery-vs-dramatiq-vs-arq-self-hosted-task-queues-guide-2026/ , https://markaicode.com/vs/celery-alternatives/
- Docling OCR engines and Arabic-script token: https://docling-project.github.io/docling/concepts/OCR_native/
- PaddleOCR PP-OCRv5 multilingual: https://www.paddleocr.ai/latest/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.html ; community ONNX Arabic group (Arabic, Urdu, Persian): https://huggingface.co/monkt/paddleocr-onnx/blob/main/README.md
- Mistral OCR pricing and languages (secondary, unverified): https://www.edenai.co/post/mistral-ocr-4-vs-top-document-parsing-apis-features-benchmarks-and-integration-guide , https://docs.mistral.ai/resources/languages
- Surya/Marker licence and platform: https://huggingface.co/deobfre/surya-ocr-2 ; Arabic weakness: KITAB-Bench as cited in search results
- Persian OCR leaderboard to consult for the bake-off: https://reza2kn-persianocr-triplethreat.hf.space/

## 9. Open items and unverified claims
- Persian accuracy of every engine is unmeasured here; the bake-off in P2 (or earlier, at P1 start) must use a real, consented gold set. This research used only synthetic images and did not send any customer data anywhere.
- Confirm on the real iPhone how Safari delivers HEIC with the current `accept`; confirm Cloudflare plan limits; confirm the production nginx `limit_req` zone; verify Mistral OCR Farsi support and retention terms before considering it.
- The vision benchmark ran three calls (USD 0.0126 total) with the existing OpenRouter key; the key was not printed.
