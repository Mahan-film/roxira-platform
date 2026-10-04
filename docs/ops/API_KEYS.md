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
per position (`TAVILY#1`). `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`KAVENEGAR_API_KEY` are only reported as set (length), with no network call.

If services show `FAIL(ssl-cert)`, your Python lacks a CA bundle (common with
python.org/Homebrew builds): run `pip install certifi` and retry. The script
uses certifi automatically when it is installed.

Key values, request headers and response bodies are never printed. The exit
code is always 0. Tavily, Exa, Brave and Jina checks are real searches and may
consume a small amount of quota.
