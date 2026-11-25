# Review checklist (any agent, any model)

This is the one review checklist for this repo. The Claude skill
`.claude/skills/review-diff/SKILL.md`, the mirror skill
`.agents/skills/review-diff/SKILL.md` and the review hook
`scripts/infra/server_agents/review_hook.py` all use this file.

1. **Reviewer is not the author.** The reviewer must be a model from another
   family than the one that wrote the diff (`docs/STRATEGY.md` §3a,
   `scripts/dev/check_reviewer_family.py`). The `reviewer` role in
   `config/models.yaml` lists the choices. If you wrote the diff, stop and say so.
2. **Scope.** Read the diff against the PR's base branch and the CI test
   output only. Locally, run only the specific test files the diff adds or
   touches (`pytest -q <file> -p no:cacheprovider`). Never run `pytest` with
   no path or over `src/` or the repo root (see `CLAUDE.md`).
   Do not read unrelated files.
3. **Checklist.** Flag anything the diff touches:
   - **Secrets**: no real or default key, token or password is added.
     Secrets are read from the environment only.
   - **Auth/payments**: any change under `*auth*`, `*payment*` or `zibal`
     gets extra care. These paths are kept away from cheap agents on purpose
     (`agent_runner.py` DENYLIST_KEYWORDS). Do not wave them through.
   - **Input validation**: every new or changed HTTP endpoint has DTO
     validation (`class-validator` and `class-transformer`, AGENTS.md §2.2).
     No raw string is joined into a query or a shell command.
   - **Migrations**: reversible, no destructive `DROP` or data loss without
     an explicit note, and in line with the rule that the repo is the source
     of truth for the server (`docs/STRATEGY.md`).
   - **Tests and gates**: a change in behaviour comes with a test, and the
     gate output shows no failure. Also check `docs/agents/LESSONS.md`.
4. **Report** a short pass or fail list, one line per checklist item, not
   prose. Block the merge on any fail. Say what is uncertain; do not guess.
