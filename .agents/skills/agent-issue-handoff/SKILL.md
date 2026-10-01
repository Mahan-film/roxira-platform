---
name: agent-issue-handoff
description: Write a small, self-contained GitHub issue for the rx worker lane
---

# agent-issue-handoff

Use before launching `rx <issue>` (Codex CLI) or `rx <issue> team` (OmniRoute combo `team-coding`).

## Issue contract
- Name the exact files and functions to change; max ~80 changed lines and 3 files.
- Inline every fact the worker needs (line numbers, current values, expected strings). Never say "read the data file".
- Exactly one offline test in the repo-root `src/`, with NO code at import time (no module-level calls, subprocess or network). A CI guard rejects it.
- Say in the issue: no git, no gh, no pytest over `src/` or the repo root, no subagents, never write a secret.
- Dot-directories such as `.agents/` may not be writable by the worker: have the hub create those files.

## Launch
- One worker: `rx <issue>`; the OmniRoute lane: `rx <issue> team`.
- Never start two `rx` in the same second (both lock `.git/config`); stagger by ~50 s.
- The hub reads the full diff and merges green PRs; a PR that calls undefined names is closed, not patched.
