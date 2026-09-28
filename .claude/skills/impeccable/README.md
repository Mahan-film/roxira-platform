# Impeccable (vendored, docs-only)

Source: https://github.com/pbakaus/impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (2026-09-25).
License: Apache License 2.0 (see the upstream repo's `LICENSE`; not copied here to keep this
folder to what the skill actually needs — reference it at the commit above).

## What is vendored

Only `skill/SKILL.src.md` (as `SKILL.md`) and `skill/reference/*.md` (37 files) — the design
guidance text. Every file was fetched from the pinned commit and read before vendoring; a scan
for injected shell/exec patterns and secrets found nothing.

## What was deliberately NOT vendored, and why

`skill/scripts/` (a per-OS launcher binary `impeccable`/`impeccable.cmd`, ~550KB of bundled
`live-browser*.js`, and `command-metadata.json`) and `skill/agents/*.md` were left out. The
upstream `SKILL.md`'s own Setup step 1 requires running
`<skill-base-dir>/scripts/impeccable context`, a self-contained binary the launcher downloads on
first run, and `reference/hooks.md` describes it installing PostToolUse/Stop hooks into
`.claude/settings.local.json`. Per this task's instructions ("no scripts, hooks, binaries or
postinstall steps; if the skill requires executables, stop and report instead"), that launcher
and the hook-install flow are not included.

**Practical effect:** the `impeccable context` setup step, the CLI-driven commands (`live`,
`generate`, the detector hook), and anything under `skill/agents/` will not work as vendored here.
The `reference/*.md` playbooks (critique, audit, polish, craft-floor, etc.) are self-contained
design guidance and are usable as reading material / a checklist without the launcher. If the
owner wants the full interactive tool, they should run `npx impeccable` themselves outside this
vendoring, and review what it installs before agreeing.
