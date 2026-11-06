#!/usr/bin/env bash
# Publish the fleet's tools and state to branch fleet-state, so another computer can take over with only git.
# Whitelist only: top-level scripts and notes, plus briefs. Logs are never published. Aborts on a key-shaped string.
set -euo pipefail
F=/home/mahan/Developer/roxira-wt/_fleet; REPO=/home/mahan/Developer/roxira-platform; W=$(mktemp -d); trap 'git -C "$REPO" worktree remove --force "$W/t" 2>/dev/null; rm -rf "$W"' EXIT
git -C "$REPO" fetch -q origin fleet-state 2>/dev/null || true
if git -C "$REPO" rev-parse -q --verify origin/fleet-state >/dev/null; then git -C "$REPO" worktree add -q --detach "$W/t" origin/fleet-state; else git -C "$REPO" worktree add -q --detach "$W/t" HEAD; (cd "$W/t"; git checkout -q --orphan fleet-state-tmp; git rm -rfq . ); fi
cd "$F"; mkdir -p "$W/t/fleet/briefs"
cp -p *.sh *.py HANDOFF.md QUEUE.md AGENT_BRIEF.md RULES.md AUDIT_230.md TRIAGE.md MAC_TAKEOVER.md "$W/t/fleet/" 2>/dev/null || true
cp -p briefs/*.md "$W/t/fleet/briefs/" 2>/dev/null || true
cd "$W/t"
if grep -rIlE 'sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|csk-[a-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY' fleet >/dev/null; then echo "key-shaped string found; nothing pushed" >&2; exit 4; fi
git add -A fleet; git diff --cached --quiet && { echo unchanged; exit 0; }
git -c user.name=claude-win -c user.email=noreply@anthropic.com commit -qm "fleet state $(date -u +%FT%TZ)"
git push -q origin HEAD:refs/heads/fleet-state && echo pushed
