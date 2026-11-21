---
name: feedback-never-collect-src-tests
description: Never run pytest (even --co) over roxira src/ outside CI — test_*.py files run git commit/checkout and agents at import
metadata:
  node_type: memory
  type: feedback
  originSessionId: c12a7d07-b39b-4ab0-ac4b-9e0df01edec6
  modified: 2026-09-24T17:45:40.407Z
---

79 of 80 `src/**/test_*.py` files in roxira-platform are scripts with import-time side effects: `git commit -m "before autonomous execution"`, `git checkout -- .` (reverts uncommitted edits), calls to opencode/aider/LLM APIs, writes `project_memory/*.json` and `*.backup_*` files. On 2026-09-24 a plain `pytest --co` locally made 3 junk commits and wiped an uncommitted pyproject edit.

**Why:** pytest imports files to collect them; marks can't prevent that.
**How to apply:** Never run pytest or import these files locally. They are listed in `src/ci_quarantine.py` (collect_ignore via `src/conftest.py`, PR #6). If a test run is needed, let CI (ephemeral runner) do it. See [[project-roxira-overview]].
