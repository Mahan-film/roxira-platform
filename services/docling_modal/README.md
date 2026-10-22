# Docling on Modal (document extraction service)

Step 1 of the Docling-on-Modal adoption (`docs/strategy/SUITE_V2_COMPOSABLE_2026-10-22.md`):
a Modal-hosted Docling service plus a stdlib client. **Flag OFF** — nothing calls it yet; the
import pipeline wires it in step 2.

## Files

| File | Role |
| --- | --- |
| `app.py` | Modal app: `POST /extract` accepts a PDF/image (multipart) and returns `{markdown, tables, pages}` as JSON. |
| `client.py` | Stdlib-only (urllib) client used by our servers: `extract(path) -> dict`. |
| `test_client.py` | Offline pytest against a local `http.server` fake (never talks to Modal). |

## Deploy

```bash
modal deploy services/docling_modal/app.py
```

Before the first deploy, create the Modal Secret (values are never in code):

```bash
modal secret create docling-modal DOCLING_SHARED_SECRET=<long-random-string>
```

The Modal SDK reads `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` from the environment (already set on
the server). Do not deploy from an agent or print the tokens.

## Request contract

- `POST /extract`, multipart field `file`, header `X-Docling-Token: <DOCLING_SHARED_SECRET>`.
- `200` → `{"markdown": str, "tables": [[[str, ...], ...], ...], "pages": int}`.
  Each table is a list of rows; each row is a list of cell strings.
- `400` empty file, `401` bad/missing token, `413` over 50 MB, `502` Docling conversion error.
- `GET /health` → `{"ok": true}` (no auth).

## Client

```python
from services.docling_modal.client import extract  # once packaged; else import client directly

result = extract("/path/to/file.pdf")  # reads DOCLING_MODAL_URL + DOCLING_MODAL_TOKEN
markdown, tables, pages = result["markdown"], result["tables"], result["pages"]
```

Env (names only):

- `DOCLING_MODAL_URL` — deployed endpoint base URL.
- `DOCLING_MODAL_TOKEN` — shared secret, sent as `X-Docling-Token`.

`extract` has a 120 s timeout and retries transport failures once. Failures are typed:
`DoclingConfigError`, `DoclingAuthError`, `DoclingRequestError`, `DoclingTransportError`
(all subclass `DoclingError`).

## Cost notes (monthly cap: $30)

- **CPU only, no GPU.** The container runs Docling on CPU and scales to zero, so idle cost is $0.
- `timeout=120 s`, `max_containers=2` (at most 2 concurrent), `scaledown_window=60 s`.
- Files are capped at 50 MB in the service.
- Rough shape: a 2-core CPU container is billed per second while parsing. At an illustrative
  ~$0.00004 per core-second, a 30 s parse costs about $0.0024, so ~$30 covers roughly 12,000
  parses/month. Verify live rates at modal.com/pricing before relying on this.
- Keep `max_containers=2` and the 120 s timeout; raising either is the main way to exceed the cap.

## Step 2 (not in this task)

The import pipeline will call `client.extract(path)` for PDFs/images when the Docling flag is on,
keeping the current vision-LLM path as the fallback (`docs/strategy/SUITE_V2_COMPOSABLE_2026-10-22.md`).
No upload path or limit change is made here.
