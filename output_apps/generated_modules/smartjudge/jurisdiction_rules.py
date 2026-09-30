"""Load jurisdiction rules maintained as repository data."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


_REQUIRED_KEYS = {
    "id",
    "forum",
    "matter",
    "threshold_rials",
    "legal_basis",
    "source_url",
    "status",
    "note",
}
_ALLOWED_STATUSES = {"confirmed", "needs_lawyer"}
_DEFAULT_RULES_PATH = Path(__file__).resolve().parents[3] / "config" / "jurisdiction_rules.yaml"


def load_rules(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load and validate jurisdiction rules from YAML, using a path-based cache."""
    rules_path = _DEFAULT_RULES_PATH if path is None else Path(path)
    return _load_rules(str(rules_path.resolve()))


@lru_cache(maxsize=None)
def _load_rules(path: str) -> list[dict[str, Any]]:
    with Path(path).open(encoding="utf-8") as rules_file:
        document = yaml.safe_load(rules_file)

    if not isinstance(document, dict) or not isinstance(document.get("rules"), list):
        raise ValueError("Jurisdiction rules YAML must contain a rules list")

    rules = document["rules"]
    seen_ids: set[Any] = set()
    for rule in rules:
        if not isinstance(rule, dict) or not _REQUIRED_KEYS.issubset(rule):
            raise ValueError("Each jurisdiction rule must include all required keys")

        rule_id = rule["id"]
        if not isinstance(rule_id, str):
            raise ValueError("Jurisdiction rule id must be a string")
        if rule_id in seen_ids:
            raise ValueError(f"Duplicate jurisdiction rule id: {rule_id}")
        seen_ids.add(rule_id)

        threshold = rule["threshold_rials"]
        if threshold is not None and type(threshold) is not int:
            raise ValueError("threshold_rials must be an integer or null")
        if not isinstance(rule["status"], str) or rule["status"] not in _ALLOWED_STATUSES:
            raise ValueError("Jurisdiction rule status is invalid")

    return rules


def confirmed_rules() -> list[dict[str, Any]]:
    """Return the currently confirmed jurisdiction rules."""
    return [rule for rule in load_rules() if rule["status"] == "confirmed"]
