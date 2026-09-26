"""Diff config/models.yaml against the live OpenRouter catalogue (W12).

Fetches GET /api/v1/models (no API key required for that endpoint) and reports,
per model id in the registry:
  - MISSING   the id is not in the live catalogue at all (likely retired/renamed)
  - PRICE     the id exists but its prompt/completion price differs from the
              registry's price_per_1m
  - ok        id found, price matches

Exits non-zero if any role's *primary* (first-listed) model is MISSING, so a
CI job or a weekly cron can gate on it. A missing/changed fallback model is
reported but does not fail the run.

Usage:
    python3 scripts/check_models.py                       # live fetch
    python3 scripts/check_models.py --offline FILE.json    # read a saved
                                                             # `GET /api/v1/models`
                                                             # response instead
                                                             # (used by tests and
                                                             # by any run with no
                                                             # network/key)
    python3 scripts/check_models.py --registry PATH.yaml   # non-default registry

No secret is required or read: OPENROUTER_API_KEY is used only if present, to
raise OpenRouter's own rate limit on this read-only endpoint; the request
works unauthenticated too.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from output_apps.generated_modules.smartjudge import model_registry  # noqa: E402

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Registry entries that are not real OpenRouter chat-completion ids (e.g. a
# local/free TTS engine) and so will never appear in GET /api/v1/models.
# check_models.py skips these rather than reporting them MISSING.
NON_OPENROUTER_PREFIXES = ("edge-tts:",)

# A registry entry can also set `catalogue_listed: false` (see config/models.yaml,
# stt role, issue #39) for a real OpenRouter id that is verified live but simply
# is not surfaced by GET /api/v1/models -- e.g. OpenRouter's dedicated
# /api/v1/audio/transcriptions models. Skipped the same way as the prefixes
# above: reported, but never counted as MISSING.


def fetch_live_catalogue(timeout: float = 20.0) -> dict[str, dict[str, Any]]:
    """id -> {"prompt": float_usd_per_token, "completion": float_usd_per_token}."""
    import urllib.request

    headers = {"Accept": "application/json"}
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(OPENROUTER_MODELS_URL, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return _index_catalogue(data)


def load_offline_catalogue(path: pathlib.Path) -> dict[str, dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return _index_catalogue(data)


def _index_catalogue(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for entry in data.get("data", []):
        model_id = entry.get("id")
        if not model_id:
            continue
        pricing = entry.get("pricing") or {}
        try:
            prompt = float(pricing.get("prompt", 0) or 0)
            completion = float(pricing.get("completion", 0) or 0)
        except (TypeError, ValueError):
            prompt = completion = 0.0
        out[model_id] = {"prompt": prompt, "completion": completion}
    return out


def _per_1m(price_per_token: float) -> float:
    return round(price_per_token * 1_000_000, 6)


def check(
    registry_path: pathlib.Path | None, catalogue: dict[str, dict[str, Any]]
) -> tuple[list[dict[str, Any]], bool]:
    """Return (report_rows, has_primary_failure)."""
    rows: list[dict[str, Any]] = []
    has_primary_failure = False

    for role in model_registry.all_role_names(registry_path):
        entries = model_registry.role_entries(role, registry_path)
        for position, entry in enumerate(entries):
            model_id = entry.get("id", "")
            is_primary = position == 0
            if any(model_id.startswith(p) for p in NON_OPENROUTER_PREFIXES) or (
                entry.get("catalogue_listed") is False
            ):
                rows.append(
                    {"role": role, "id": model_id, "primary": is_primary, "status": "skipped"}
                )
                continue

            live = catalogue.get(model_id)
            if live is None:
                rows.append(
                    {"role": role, "id": model_id, "primary": is_primary, "status": "MISSING"}
                )
                if is_primary:
                    has_primary_failure = True
                continue

            declared = entry.get("price_per_1m") or {}
            row: dict[str, Any] = {
                "role": role,
                "id": model_id,
                "primary": is_primary,
                "status": "ok",
                "live_price_per_1m": {
                    "in": _per_1m(live["prompt"]),
                    "out": _per_1m(live["completion"]),
                },
            }
            if declared:
                declared_in = float(declared.get("in", 0) or 0)
                declared_out = float(declared.get("out", 0) or 0)
                live_in = _per_1m(live["prompt"])
                live_out = _per_1m(live["completion"])
                # Small tolerance for float round-tripping through YAML/JSON.
                if abs(declared_in - live_in) > 1e-6 or abs(declared_out - live_out) > 1e-6:
                    row["status"] = "PRICE"
                    row["registry_price_per_1m"] = {"in": declared_in, "out": declared_out}
            rows.append(row)
    return rows, has_primary_failure


def _print_report(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        if row["status"] == "ok":
            continue
        marker = "*" if row["primary"] else " "
        print(f"[{row['status']:8}]{marker} {row['role']:12} {row['id']}")
        if row["status"] == "PRICE":
            print(
                f"           registry={row['registry_price_per_1m']} "
                f"live={row['live_price_per_1m']}"
            )
    ok = sum(1 for r in rows if r["status"] == "ok")
    skipped = sum(1 for r in rows if r["status"] == "skipped")
    print(f"\n{ok} ok, {skipped} skipped (non-OpenRouter), {len(rows) - ok - skipped} flagged, "
          f"{len(rows)} total entries in config/models.yaml")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--offline",
        type=pathlib.Path,
        default=None,
        help="Read a saved GET /api/v1/models JSON response instead of fetching live.",
    )
    ap.add_argument(
        "--registry",
        type=pathlib.Path,
        default=None,
        help="Path to models.yaml (defaults to config/models.yaml).",
    )
    ap.add_argument(
        "--json", action="store_true", help="Print the machine-readable report instead of text."
    )
    args = ap.parse_args(argv)

    try:
        if args.offline:
            catalogue = load_offline_catalogue(args.offline)
        else:
            catalogue = fetch_live_catalogue()
    except Exception as exc:  # network error, bad JSON, etc.
        print(f"error: could not obtain the OpenRouter model catalogue: {exc}", file=sys.stderr)
        return 2

    try:
        rows, has_primary_failure = check(args.registry, catalogue)
    except model_registry.ModelRegistryError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        _print_report(rows)

    if has_primary_failure:
        print("\nFAIL: at least one role's primary model is missing from OpenRouter.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
