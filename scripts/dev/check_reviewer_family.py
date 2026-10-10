#!/usr/bin/env python3
"""Check that config/models.yaml `executor` and `reviewer` are different model families.

A reviewer from the same vendor as the executor shares its blind spots (see
docs/research/AUTONOMY_AND_SAFETY_2026-10.md). The rule: the reviewer list must
contain at least one model from a different family than the executor's primary
(first) model. Reviewer entries that share the executor's family are listed as
notes (the owner's priority order keeps DeepSeek in the reviewer fallback chain),
not failures. Exits 1 when no reviewer model differs from the executor primary,
0 otherwise, 2 on a registry error. Stdlib + pyyaml only; reads the registry
through model_registry.py.

Usage: python3 scripts/dev/check_reviewer_family.py [--registry PATH.yaml]
"""

from __future__ import annotations

import argparse
import fnmatch
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY_MODULE = ROOT / "output_apps" / "generated_modules" / "smartjudge" / "model_registry.py"

# family -> fnmatch globs matched against the provider prefix (lowercase).
FAMILY_ALIASES: dict[str, tuple[str, ...]] = {
    "deepseek": ("deepseek*",),
    "qwen": ("qwen*", "alibaba*"),
    "glm": ("glm*", "z-ai", "zai*"),
    "openai": ("openai*",),
    "google": ("google*", "gemini*"),
    "anthropic": ("anthropic*", "claude*"),
    "mistral": ("mistral*",),
    "meta": ("meta*", "llama*"),
    "xiaomi": ("xiaomi*", "mimo*"),
}


def family(model_id: str) -> str:
    """Family of a model id: provider prefix before the first slash, alias-folded."""
    prefix = str(model_id).strip().lower().split("/", 1)[0]
    for name, globs in FAMILY_ALIASES.items():
        if any(fnmatch.fnmatch(prefix, g) for g in globs):
            return name
    return prefix


def same_family(a: str, b: str) -> bool:
    """True when two model ids belong to the same vendor family. Pure."""
    fa, fb = family(a), family(b)
    return bool(fa) and fa == fb


def find_overlaps(executor: list[str], reviewer: list[str]) -> list[tuple[str, str]]:
    """Every (executor_id, reviewer_id) pair sharing a family."""
    return [(e, r) for e in executor for r in reviewer if same_family(e, r)]


def _load_registry():
    spec = importlib.util.spec_from_file_location("model_registry", REGISTRY_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--registry", type=Path, default=None)
    args = ap.parse_args(argv)
    try:
        reg = _load_registry()
        executor = reg.role_models("executor", args.registry)
        reviewer = reg.role_models("reviewer", args.registry)
    except Exception as exc:  # registry missing/malformed: distinct exit code
        print(f"cannot read registry: {exc}", file=sys.stderr)
        return 2
    print(f"executor: {', '.join(executor) or '(none)'}")
    print(f"reviewer: {', '.join(reviewer) or '(none)'}")
    if not executor or not reviewer:
        print("FINDING: executor or reviewer role has no models")
        return 1
    primary = executor[0]
    different = [r for r in reviewer if not same_family(primary, r)]
    for e, r in find_overlaps([primary], reviewer):
        print(f"note: reviewer {r} is the same family as executor primary {e} ({family(e)})")
    if not different:
        print(f"FINDING: no reviewer model differs from executor primary {primary} ({family(primary)})")
        return 1
    print(f"ok: reviewer has a model in a different family from executor primary {primary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
