# Checking provider API keys

`scripts/dev/check_keys.py` verifies that the keys in your environment are
accepted by their providers. Stdlib only, no side effects on import.

```bash
set -a; source ~/Secrets/roxira/roxira.env; set +a
python3 scripts/dev/check_keys.py
```

It makes one minimal authenticated request per key that is set (10 s timeout,
sequential) and prints `NAME  OK|FAIL(401)|FAIL(403)|FAIL(timeout)|FAIL(network)|FAIL(ssl-cert)|SKIP(not set)  <ms>`.
`TAVILY_API_KEYS` and `ASSEMBLYAI_API_KEYS` are comma-separated and reported
per position (`TAVILY#1`). `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the
presence-only keys (`TINYFISH_API_KEY`, `MODAL_TOKEN_ID`, `R2_ACCESS_KEY_ID`,
`NEON_BACKUP_URL`) are only reported as set (length), with no network call.

## What it covers

| Covered (authenticated request) | Not covered |
| --- | --- |
| OpenRouter, Mistral, Groq, SambaNova, Cerebras, Brave, Exa, Jina, Firecrawl, Gemini, Daytona, Cloudflare, Codeberg, Kavenegar, SMS.ir, Telegram, Tavily, AssemblyAI, Qdrant Cloud, OmniRoute | NVIDIA NIM, DeepSeek direct, Chutes, Together, Fireworks, TinyFish, Modal, Zilliz, R2 |

"Not covered" means the key is never verified against the provider. TinyFish,
Modal and R2 are still read and reported as `set (len=...)` (presence only, no
request); the rest are not read at all.

If services show `FAIL(ssl-cert)`, your Python lacks a CA bundle (common with
python.org/Homebrew builds): run `pip install certifi` and retry. The script
uses certifi automatically when it is installed.

Key values, request headers and response bodies are never printed. The exit
code is always 0. Tavily, Exa, Brave and Jina checks are real searches and may
consume a small amount of quota.
