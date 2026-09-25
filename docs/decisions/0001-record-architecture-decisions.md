# 1. Record architecture decisions

Date: 2026-09-25
Status: accepted

## Context

Decisions about this repo's shape (models, agents, CI, infra) were living
only in chat history and `docs/STRATEGY.md`. STRATEGY.md is a living status
document — it gets edited and superseded — so it's a poor place to find
*why* a specific choice was made once its status row has moved on.

## Decision

Record significant, hard-to-reverse decisions as short ADRs under
`docs/decisions/`, numbered sequentially (`000N-title.md`). Each one:

- States the context, the decision, and the consequences — not a design doc.
- Stays under ~40 lines. If it needs more, the detail belongs in
  `docs/STRATEGY.md` or a dedicated doc, and the ADR links to it.
- Is never edited after acceptance. A later decision that changes course adds
  a new ADR and marks the old one's Status as `superseded by 000N`.

Use an ADR for: model/vendor choices, security boundaries (e.g. where agents
are allowed to run), and anything that would otherwise need re-explaining in
every new chat.

Do not use an ADR for: routine workstream status (STRATEGY.md §5), or
anything reversible in a single PR without discussion.

## Consequences

- One more file to write per significant decision, but it is cheap (a few
  minutes) compared to re-deriving the reasoning from git blame or chat scroll.
- `docs/plan.md` and `docs/progress.md` cover the shorter-lived, task-level
  memory; ADRs are for the decisions that outlive any one task.
