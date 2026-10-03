"""Data-class lane policy for the agentic CRM (AGENTS.md §4, docs/STRATEGY.md §3b).

Hard rule: customer/case data may never reach a ``free``-tier model. This is a
pure library: it makes no network call, reads no secret, and holds no default
key. The registry is injected (tests) or read from ``config/models.yaml`` via
``output_apps/generated_modules/smartjudge/model_registry.py``.

    from src.crm_agents import model_gateway as gw

    model_id = gw.choose_model("customer", "strong")   # first model for the role
    safe = gw.redact("تماس 09123456789 / a@b.ir")
    out = gw.call(prompt, data_class="customer", role="strong",
                  send=provider.send, registry=registry, log=audit_log)

``call`` never passes the prompt to ``log``: only the model id, role, data
class, a SHA-256 of the prompt, and the redacted prompt's length are logged.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from typing import Any

DATA_CLASSES = ("public", "customer")
NON_SENSITIVE_POLICY = "non_sensitive_only"


class LaneViolation(ValueError):
    """Raised when a data class is not allowed on the requested role.

    The message intentionally carries only the role and its data policy; it
    never includes the prompt or any other customer data.
    """


def _default_registry() -> dict[str, Any]:
    """The ``roles:`` mapping from config/models.yaml (lazy import: no cycle)."""
    from output_apps.generated_modules.smartjudge import model_registry

    return model_registry.roles()


def choose_model(
    data_class: str,
    role: str,
    registry: dict[str, Any] | None = None,
) -> str:
    """Return the first model id for ``role`` allowed to carry ``data_class``.

    ``registry`` is ``{role: {data_policy, models: [{id}, ...]}}``; when None it
    is loaded from config/models.yaml. Customer data is allowed only for roles
    whose ``data_policy`` is not ``non_sensitive_only``, and never for ``free``.
    Raises LaneViolation on an unknown data class, unknown role, a forbidden
    lane, or a role with no models configured.
    """
    if data_class not in DATA_CLASSES:
        raise LaneViolation(
            f"unknown data_class {data_class!r}; expected one of {DATA_CLASSES}"
        )

    reg = registry if registry is not None else _default_registry()
    role_entry = reg.get(role)
    if role_entry is None:
        raise LaneViolation(f"unknown role {role!r}")

    policy = role_entry.get("data_policy", "standard")
    if data_class == "customer" and (role == "free" or policy == NON_SENSITIVE_POLICY):
        raise LaneViolation(
            f"customer data is not allowed for role {role!r} "
            f"(data_policy={policy!r})"
        )

    models = role_entry.get("models") or []
    model_ids = [m["id"] for m in models if isinstance(m, dict) and m.get("id")]
    if not model_ids:
        raise LaneViolation(f"role {role!r} has no models configured")
    return model_ids[0]


# Patterns are matched against a digit-normalised (ASCII) copy so that every
# pattern sees one digit alphabet. Persian ۰-۹ and Arabic-Indic ٠-٩ are then
# masked in the ORIGINAL text, preserving every non-masked character verbatim.
_DIGIT_TRANS = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩",
    "01234567890123456789",
)

_DIGIT = "[0-9]"
_ZERO = "0"
_NINE = "9"
_EIGHT = "8"
_NOT_DIGIT_BEFORE = "(?<![0-9])"
_NOT_DIGIT_AFTER = "(?![0-9])"

_MASK = "[REDACTED]"

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# 16 digits, optionally grouped 4-4-4-4 with a space or dash separator.
_CARD_RE = re.compile(
    rf"{_NOT_DIGIT_BEFORE}(?:{_DIGIT}{{4}}[ -]?){{3}}{_DIGIT}{{4}}{_NOT_DIGIT_AFTER}"
)
# 09xxxxxxxxx, +989xxxxxxxxx, 00989xxxxxxxxx.
_MOBILE_RE = re.compile(
    rf"{_NOT_DIGIT_BEFORE}"
    rf"(?:\+{_NINE}{_EIGHT}|{_ZERO}{_ZERO}{_NINE}{_EIGHT}|{_ZERO})"
    rf"{_NINE}{_DIGIT}{{9}}{_NOT_DIGIT_AFTER}"
)
# Exactly 10 digits: national id.
_NATIONAL_ID_RE = re.compile(
    rf"{_NOT_DIGIT_BEFORE}{_DIGIT}{{10}}{_NOT_DIGIT_AFTER}"
)
# Cards before national ids so a 16-digit run is one match, not 10 + leftovers.
_REDACT_PATTERNS = (_EMAIL_RE, _CARD_RE, _MOBILE_RE, _NATIONAL_ID_RE)


def redact(text: str) -> str:
    """Mask emails, mobiles, national ids and card-like numbers, ASCII or Persian.

    Every pattern is detected on a digit-normalised copy (same length, so
    indexes map 1:1) and the matching span is replaced in the original text.
    Each match becomes ``[REDACTED]``; all other characters are untouched.
    """
    normalized = text.translate(_DIGIT_TRANS)
    consumed = [False] * len(text)
    spans: list[tuple[int, int]] = []
    for pattern in _REDACT_PATTERNS:
        for match in pattern.finditer(normalized):
            start, end = match.span()
            if any(consumed[start:end]):
                continue
            for index in range(start, end):
                consumed[index] = True
            spans.append((start, end))

    spans.sort()
    parts: list[str] = []
    cursor = 0
    for start, end in spans:
        parts.append(text[cursor:start])
        parts.append(_MASK)
        cursor = end
    parts.append(text[cursor:])
    return "".join(parts)


def call(
    prompt: str,
    *,
    data_class: str,
    role: str,
    send: Callable[[str, str], str],
    registry: dict[str, Any] | None = None,
    log: Callable[[dict[str, Any]], None] | None = None,
) -> str:
    """Validate the lane, call ``send(model_id, prompt)``, return its output.

    ``log`` receives exactly ``{model_id, role, data_class, prompt_sha256,
    redacted_len}`` and never the prompt. A LaneViolation is raised (and
    ``send`` is not called) before anything is logged.
    """
    model_id = choose_model(data_class, role, registry)
    if log is not None:
        log(
            {
                "model_id": model_id,
                "role": role,
                "data_class": data_class,
                "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "redacted_len": len(redact(prompt)),
            }
        )
    return send(model_id, prompt)
