# Iran-first roadmap, then global (2026-10-31)

Owner decision: Iran is priority one. One core, country packs, separate data cells.

## Execution stages

| Stage | Goal | Done when |
|---|---|---|
| 1 Iran foundation | Tax, cheques, bank reconciliation, universal import, reports, petty cash merged | A sample company goes from file upload to balanced statements |
| 2 Iran compliance | Moadian, Tamin, payroll and statutory parameters, checked against official sources | Each rule has a source, effective date and test |
| 3 Requirements audit | Requirement catalogue per module, checked against code and tests by agents | Each gap is an issue with an acceptance test |
| 4 Global core | Multi-book, multi-currency, multi-language, calendars, jurisdiction packs | Iran itself runs as the first pack |
| 5 First foreign pack | Market chosen by the owner from research (candidates: UAE, Saudi Arabia) | One foreign sample company closes a year |
| 6 More packs | Europe, then other regions, each after legal review | Pack passes the same conformance suite |

## Architecture rules

- Core: ledger, parties, items, documents, users, roles, workflow, API, audit.
- Country pack: chart templates, tax rules, e-invoice adapters, payroll rules, statutory reports,
  each versioned with effective dates. Packs hold rules and adapters and never fork the core.
- Cells: Iran and global run the same code with separate databases, keys and backups.
- AI proposes; deterministic rules post. No model output reaches the ledger without validation and,
  where configured, human approval.
- Keep NestJS, Next.js and Postgres. Add services only after a proven need; the server has 8 GB RAM.

## Factory rules

- One issue, one worktree, one owner of a file area; 3 to 4 writers at once, more for read-only audit.
- Migrations land one at a time. Every PR is reviewed by a different model family.
- GitHub is the source of truth, Codeberg a mirror. No customer data or secrets in agent context.
- Merges use `gh pr merge --auto --squash` under the owner's standing authority (2026-10-31).
