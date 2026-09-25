---
name: review-diff
description: Review only the current diff and test output (not the whole repo) against a fixed checklist before a PR merges. Use right before opening or merging a PR, or when asked to review an agent's changes. The reviewer must be a different model from the one that wrote the diff (docs/STRATEGY.md §3a).
---

1. Confirm the reviewer is not the author model for this diff (e.g. executor
   wrote it → `reviewer` role from `config/models.yaml` reviews it, never the
   same id). If you are the author model, stop and say so instead of reviewing.
2. Scope: `git diff` against the PR's base branch, plus the CI test output
   (the run ci.yml produced, or `pytest -m "not integration"` locally — never
   the full `src/` suite, see CLAUDE.md). Do not read unrelated files.
3. Checklist — flag anything the diff touches:
   - **Secrets**: no real or default key/token/password added; nothing reads
     outside the environment for a secret.
   - **Auth/payments**: any change under `*auth*`, `*payment*`, `zibal` gets
     extra scrutiny — this is exactly what `agent_runner.py`'s DENYLIST_KEYWORDS
     exists to keep cheap agents away from; a human/reviewer model must not
     wave it through casually.
   - **Input validation**: every new/changed HTTP endpoint has DTO validation
     (`class-validator`/`class-transformer`, AGENTS.md §2.2); no raw string
     concatenation into a query or shell command.
   - **Migrations**: reversible, no destructive `DROP`/data loss without an
     explicit note, and consistent with `docs/STRATEGY.md`'s "repo is the
     source of truth for the server" rule.
4. Report as a short pass/fail list per checklist item, not prose. Block merge
   on any fail; note anything uncertain rather than guessing.
