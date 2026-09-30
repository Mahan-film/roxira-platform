# 0003. Agent operating model: escalation ladder and weekly Claude budget

Date: 2026-09-30. Status: proposed (owner approval pending). Supersedes the "never Claude subagents" line of the
STRATEGY.md Role rule; everything else in that rule stays.

## Context

- The owner wants the most work per Claude plan limit, with at most 3-4 hours without Claude at the end of a week.
- 2026-09-28: parallel Claude subagents exhausted the weekly limit.
- 2026-09-30: three `rx 138` runs failed on a ~300-line legal-core task (two "no changes", one PR #147 that called
  functions it never defined). Small tasks on the same lane succeed (#133, #134, #139 → #145).
- 2026-09-30: one Claude `implementer` subagent used ~20k tokens and produced nothing, because subagents in this setup
  cannot run `git` (the rtk wrapper is refused by the harness).
- The owner now allows Claude agents and extra chats when that is the cheapest way to finish.

## Decision

**1. Escalation ladder (cheapest first; move up only after one failed attempt):**

| Step | Who | For | Claude quota |
| --- | --- | --- | --- |
| 1 | `rx` / `rxall` (OpenCode on the LiteLLM pool: dsflash, then dspro) launched by the hub | one issue, ≤ ~80 changed lines, ≤ 3 files, self-contained spec | none |
| 2 | Claude subagent `implementer` (Sonnet), file edits only; the hub runs git | fix or finish a failed step-1 diff; legal core, auth, payments | low |
| 3 | Separate Sonnet workstream chat | work that cannot be specified up front (design, investigation) | medium |
| 4 | Opus | architecture decision records only | high, rare |

**2. Issue sizing rule.** An `rx` issue names the exact files and functions, inlines every fact the worker needs
(no "read the data file"), says "no subagents, no shell", and has one offline test in `src/`. Larger work is split
into several such issues before any worker starts.

**3. Concurrency caps.** At most 3 `rx` workers, 2 Claude subagents and 1 extra Claude chat at a time. Not 10-30 chats:
every new Claude chat or subagent pays a fixed start-up cost (system prompt, MCP tool lists, CLAUDE.md) before doing
any work, so many small Claude agents cost more than one hub plus free workers.

**4. Weekly budget.** Hub on Sonnet; `/handoff` and a new chat at ~60% context instead of `/compact`. If plan usage
passes 50% before mid-week or 80% at any time, the hub stops steps 2-3 and uses step 1 only until the reset.

**5. Review gate (unchanged).** The hub reads the full diff of every worker PR; a PR that references an undefined
name is closed, not patched. `tester` (Haiku) runs only the CI-collected checks.

**6. Tools evaluated and not adopted (no new moving parts without a measured gap):**
- OmniRoute (LLM gateway with provider fallback): duplicates the LiteLLM pool already running on the Mac.
  Its "use subscription accounts through a proxy" mode is out of scope for us.
- Graphify (codebase knowledge graph): duplicates codebase-memory MCP, which is already indexed for this repo.
- Obsidian MCP: `docs/` is already plain Markdown indexed by qmd. The owner may open `docs/` as an Obsidian vault
  for reading; no MCP server is added.
- More skill packs (superpowers, ui-ux-pro-max, taste-skill, memory plugins): each adds tokens to every session and
  overlaps with `impeccable`, engram and `.claude/agents/`.

**7. Replaceability (how we stay able to swap technology later).** Keep every seam as data or a contract:
models in `config/models.yaml`; the LLM gateway behind one OpenAI-compatible URL; AI core ↔ app via OpenAPI;
design as tokens in one file consumed by Tailwind; decisions as ADRs in this folder. A new framework or model then
replaces one side of a seam, not the system.

## Follow-up issues to file

- `rx`: accept a base branch (continue an existing PR), run `ruff check --select F821` before opening a PR, and
  fall back dsflash → dspro automatically on "no changes". Move `rx`/`rxall` into `scripts/dev/` so they are versioned.
- Let subagents use git (or document that the hub commits for them).
- Design: one design-token file + W26 (#144) chat declutter, then a Swiss/editorial visual pass with `impeccable`.
- Trim unused MCP servers and plugins from the hub session (owner action in Claude settings).
