# Project briefs (W9 Phase B, item 3)

Output of `python -m src.automation.tech_radar --project-brief "<idea>"`.

Each run writes `<slug>.md` (Persian/English narrative, cited sources kept in
their original language) and a sibling `<slug>.json` (full structured
payload: per-layer alternatives, scores, costs, and the final reconciled
brief) to this directory.

```bash
python -m src.automation.tech_radar \
  --project-brief "Persian real-time voice legal assistant: STT, LLM, TTS, RAG, vector DB" \
  --json
```

Layers researched every run: UI/UX, frontend, backend, infra/server,
database/SQL, AI models, observability, security, cost. Per-layer research
and synthesis run on the `cheap` OpenRouter tier; the final cross-layer
reconciliation is the one call that spends the `strong` tier (see
`docs/STRATEGY.md` §3b and `src/automation/project_brief.py`).

A run's `status` is `SUCCESS` only if every layer *and* the final synthesis
produced usable output. `DEGRADED`/`FAILED` runs still write their files (so
partial evidence is not thrown away) but the CLI exits non-zero — never
"completed successfully" on a degraded run (docs/research/bakeoff.md §1
finding 5).
