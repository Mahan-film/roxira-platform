# Token hygiene for the hub (one page for the owner)

Every enabled plugin, connector and skill adds text to each Claude session.
Fewer of them means more room for real work and a lower bill.
Change these in the Claude desktop app settings (Plugins and Connectors).
The longer background is in `docs/STRATEGY.md` §4.

## Plugins and skills

| Keep on | Why |
|---|---|
| engineering | code review, debugging, deploy checklists |
| engram | memory across sessions |
| codebase-memory | code graph: "where is X", "who calls Y" |
| qmd | search over the repo docs |
| context7 | current library docs |
| artifact and document skills | reports and pages for the owner |

| Turn off for the hub | Why |
|---|---|
| marketing | not hub work |
| data | not hub work |
| design | not hub work; turn on only for a UI session |
| product-management | not hub work |
| productivity | not hub work |

## Connectors

Turn off: **Canva, Asana, Slack, Figma, Linear**. The hub does not use them.
Each one still loads its tool list into every session, and some ask to sign in.
Turn one on again only for the one session that needs it.

## Effort and modes

- Use **medium** effort for routine work: merges, small fixes, status checks.
  Use high effort only for a hard design or a deep review.
- Leave **ultracode** off for routine work. It is for rare, large jobs.

## Check the cost

- `/usage`: what this session and plan have used.
- `/context`: what fills the context right now (plugins, files, chat).
  If plugins or connectors take a big share, turn more of them off.

## Built-in helpers (no model call)

- After every compaction, the hook in `.claude/settings.json` runs
  `scripts/dev/auto_handoff.sh`. It prints the branch, your open PRs and the
  top of `docs/STATE.md`, so the session gets its state back for free.
  Any agent can run it by hand: `bash scripts/dev/auto_handoff.sh`.
- `.claude/hooks/guard_bash.sh` stops `pytest` over `src/` or the repo root,
  and `--no-verify`, before they run.
