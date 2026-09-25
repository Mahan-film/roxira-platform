"""Actor allowlist check shared by every Project Factory workflow.

Mirrors the comma-padded match `.github/workflows/agent-task.yml` uses for
`AGENT_ALLOWED_ACTORS` (`contains(format(',{0},', vars.AGENT_ALLOWED_ACTORS
|| 'mahan-films'), format(',{0},', actor))`), as a testable Python function
instead of only living inline in YAML `if:` expressions. The Project Factory
workflows (factory-plan.yml's /approve comment, factory-status.yml's /status
comment) reuse the same `AGENT_ALLOWED_ACTORS` repo variable and this same
check, via factory_approval_gate.py / factory_status.py.
"""

from __future__ import annotations

DEFAULT_ALLOWED_ACTOR = "mahan-films"


def is_actor_allowed(actor: str, allowed_csv: str | None) -> bool:
    """True if `actor` is in the comma-separated allowlist.

    Case-sensitive exact match on a GitHub login. Padding with commas on both
    sides of the compare means an allowlist entry of "mahan-films" never
    matches an actor "mahan-films2" (or a stray substring anywhere else).
    An empty/whitespace-only `allowed_csv` falls back to DEFAULT_ALLOWED_ACTOR,
    same default as the repo variable.
    """
    actor = (actor or "").strip()
    if not actor:
        return False
    csv = (allowed_csv or "").strip() or DEFAULT_ALLOWED_ACTOR
    names = [n.strip() for n in csv.split(",") if n.strip()]
    return actor in names
