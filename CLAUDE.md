@AGENTS.md

# Working in this repo

- Read `docs/STATE.md` first (current state), then `docs/SYSTEM_MAP.md` (what exists), then `docs/STRATEGY.md` only as needed. Work only on the workstream you were given. At ~60% context or when done, run `/handoff`. Parallel-chat rules: `docs/PARALLEL_CHATS.md`.
- Reply to the owner in Persian (Farsi). Code, commits and docs are in English.
- **Never run `pytest` (even `--co`) over `src/` or the repo root.** Most `test_*.py` files run `git commit` / `git checkout -- .` and call paid LLM APIs at import time. Only run the tests CI runs (see `src/ci_quarantine.py`, PR #6).
- Always `git fetch && git checkout origin/main` before starting: a server daemon pushes to `main` every ~30 minutes.
- Never read `repomix-output.xml`, `database_snapshots/`, `*.sql` or `*.tar.gz`.
- Use the codebase-memory MCP for structural questions before opening files.
- Secrets: read from the environment only. Never write a real key or a default key into code.
- Production server: `ssh 5.75.200.67`, repo at `/opt/roxira_platform`. Inspect freely. Ask before restarting containers or changing files there.
