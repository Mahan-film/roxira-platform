# Plan

Lightweight, file-scoped task memory (W12, docs/STRATEGY.md §4). This is a
checklist, not a design doc — keep entries short and link elsewhere for detail.

## How to use this file

- Before any change touching more than 3 files, add a checklist item here
  first: a one-line goal, the file list, and the plan. See the
  `feature-plan` skill (`.claude/skills/feature-plan/`).
- Check items off (`- [x]`) as they land, in the same PR that does the work.
- Move a finished item's one-line summary to `docs/progress.md` instead of
  deleting it, so the history survives.
- Do not duplicate `docs/STRATEGY.md` §5 (the workstream table) — this file
  is for the current slice of work inside a workstream, not the workstream
  list itself.

## Open items (seeded from docs/STRATEGY.md §5, 2026-09-25)

- [ ] W6: ingest the 3 owner-supplied legal-corpus files (Civil Procedure
      1379, Cheque Law 1397, Dispute Councils 1402), then re-run the eval;
      switch production to `iran_laws_v2` only if citation accuracy clearly
      beats 16.7%. Owner-run (server + files).
- [ ] W7: measure STT/LLM/TTS p50, then streaming TTS; target p50 < 2s.
      Depends on W5.
- [ ] W9: live run of the deep-research agent on the 3 briefs
      (`docs/research/LIVE_RUN.md`, budget ≤ $1.50). Owner-run.
- [ ] W10: owner setup — capped `OPENROUTER_AGENT_KEY` secret, `AGENT_ENABLED`
      repo variable, branch protection on `main`, one low-risk `agent`-labelled
      issue run end to end.
- [ ] W11: Project Factory — depends on the W9 live run and W10 setup above.
- [ ] W12 (this workstream): "cheap hands, open memory" — opencode.json
      non-interactive permissions, `model-registry-check.yml`, plan/progress/
      decisions memory, `feature-plan`/`review-diff` skills, post-edit lint
      hook. See `docs/decisions/0002-model-registry.md`.
- [ ] W13: builder token & cost ledger, daily $ cap, cheap-first routing with
      escalation, prompt caching, weekly Persian cost report. Depends on W5, W10.
- [ ] W5: flip the `cheap` tier flag on, once the W6 eval passes.
- [ ] W21b: glassmorphism design tokens + app shell. Add glass CSS
      variables/Tailwind theme entries/utilities in frontend
      `src/app/globals.css` (three elevations + fallbacks), then apply only to
      the shell: page background (`src/app/chat/page.tsx`,
      `src/app/judge/page.tsx`), header (`src/components/layout/ghazi-header.tsx`),
      footer (`src/components/layout/enamad-footer.tsx`), and chat composer
      (`src/components/chat/chat-shell.tsx`). Update frontend `DESIGN.md`.
      Verify `npm run build` + `npx tsc --noEmit`.
