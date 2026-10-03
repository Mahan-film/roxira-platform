#!/usr/bin/env python3
"""Report Python imports that cross the Smart Judge / Roxira product boundary.

Phase 1 of the product split: nothing moves. Every ``.py`` file under the scan
roots is parsed with ``ast`` (never imported). Each import is resolved to a repo
file, both ends are mapped to a product via ``config/import_boundaries.json``,
and an edge between a restricted pair of products fails unless the exact
``from_file -> to_file`` edge is in ``allowed_edges`` (the baseline).

Exit code is 1 only for NEW (non-baselined) edges. ``--write-baseline``
rewrites ``allowed_edges`` from the current code.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from collections.abc import Iterable, Iterator
from pathlib import Path

CONFIG_REL = "config/import_boundaries.json"
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".venv", "venv", ".next", ".claude"}


def load_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def iter_py_files(repo: Path, scan_roots: Iterable[str]) -> Iterator[str]:
    for root in scan_roots:
        base = repo / root
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*.py")):
            rel = p.relative_to(repo)
            if SKIP_DIRS.intersection(rel.parts):
                continue
            yield rel.as_posix()


def _under(path: str, prefix: str) -> bool:
    prefix = prefix.rstrip("/")
    return path == prefix or path.startswith(prefix + "/")


def product_of(path: str, products: dict) -> str | None:
    """Return the product owning ``path`` (longest matching prefix wins)."""
    best: tuple[int, str] | None = None
    for name, spec in products.items():
        if any(_under(path, ex) for ex in spec.get("exclude", [])):
            continue
        for prefix in spec["paths"]:
            if _under(path, prefix) and (best is None or len(prefix) > best[0]):
                best = (len(prefix), name)
    return best[1] if best else None


def _module_file(repo: Path, base: str, parts: list[str]) -> str | None:
    """Return the repo-relative file for dotted ``parts`` under ``base``, if any."""
    if not parts:
        return None
    root = repo if base == "." else repo / base
    target = root.joinpath(*parts)
    if target.with_suffix(".py").is_file():
        return target.with_suffix(".py").relative_to(repo).as_posix()
    if (target / "__init__.py").is_file():
        return (target / "__init__.py").relative_to(repo).as_posix()
    if target.is_dir():
        # Namespace package: attribute the edge to the directory itself.
        return target.relative_to(repo).as_posix() + "/"
    return None


def _from_candidates(
    roots: list[str], rel_file: str, node: ast.ImportFrom
) -> list[tuple[str, list[str]]] | None:
    """(base, module parts) lookup candidates for a ``from`` import."""
    mod = node.module.split(".") if node.module else []
    if node.level == 0:
        return [(r, mod) for r in roots]
    pkg = rel_file.split("/")[:-1]
    drop = node.level - 1
    if drop > len(pkg):
        return None
    pkg = pkg[: len(pkg) - drop]
    return [(".", pkg + mod)]


def targets_for(repo: Path, roots: list[str], rel_file: str, node: ast.AST) -> list[str]:
    """Repo files (or namespace dirs) an import statement may refer to."""
    out: list[str] = []
    if isinstance(node, ast.Import):
        for alias in node.names:
            for base in roots:
                hit = _module_file(repo, base, alias.name.split("."))
                if hit:
                    out.append(hit)
                    break
        return out
    if not isinstance(node, ast.ImportFrom):
        return out
    candidates = _from_candidates(roots, rel_file, node)
    for base, mod_parts in candidates or []:
        for alias in node.names:
            # ``from pkg import name`` may name a submodule; prefer it.
            sub = _module_file(repo, base, [*mod_parts, alias.name])
            hit = sub if sub and not sub.endswith("/") else _module_file(repo, base, mod_parts)
            hit = hit or sub
            if hit:
                out.append(hit)
        if out:
            break
    return out


def _is_path_literal(repo: Path, value: object) -> bool:
    """True for a string literal naming an existing repo-relative ``.py`` file."""
    return (
        isinstance(value, str)
        and "/" in value
        and value.endswith(".py")
        and not value.startswith("/")
        and (repo / value).is_file()
    )


def collect_edges(repo: Path, config: dict) -> dict[tuple[str, str], tuple[str, str, int]]:
    """Map (from_file, to_file) -> (from_product, to_product, first line)."""
    products = config["products"]
    roots = config["import_roots"]
    edges: dict[tuple[str, str], tuple[str, str, int]] = {}
    for rel in iter_py_files(repo, config["scan_roots"]):
        src_prod = product_of(rel, products)
        if src_prod is None:
            continue
        try:
            tree = ast.parse((repo / rel).read_text(encoding="utf-8", errors="replace"))
        except (SyntaxError, ValueError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                targets = targets_for(repo, roots, rel, node)
            elif isinstance(node, ast.Constant) and _is_path_literal(repo, node.value):
                # Path-based dynamic loading, e.g. dynamic_import("x", "a/b/c.py").
                targets = [node.value]
            else:
                continue
            for target in targets:
                dst_prod = product_of(target.rstrip("/"), products)
                if dst_prod is None or dst_prod == src_prod:
                    continue
                edges.setdefault((rel, target), (src_prod, dst_prod, node.lineno))
    return edges


def restricted(config: dict, src_prod: str, dst_prod: str) -> bool:
    return [src_prod, dst_prod] in config["restricted_pairs"]


def evaluate(repo: Path, config: dict) -> tuple[list[dict], list[dict], list[dict]]:
    """Return (all restricted edges, new edges, stale baseline entries)."""
    found = []
    for (src, dst), (sp, dp, line) in sorted(collect_edges(repo, config).items()):
        if restricted(config, sp, dp):
            found.append(
                {"from": src, "to": dst, "from_product": sp, "to_product": dp, "line": line}
            )
    allowed = {(e["from"], e["to"]) for e in config.get("allowed_edges", [])}
    new = [e for e in found if (e["from"], e["to"]) not in allowed]
    current = {(e["from"], e["to"]) for e in found}
    stale = [e for e in config.get("allowed_edges", []) if (e["from"], e["to"]) not in current]
    return found, new, stale


def render(found: list[dict], new: list[dict], stale: list[dict]) -> str:
    lines = [
        f"Import boundary report: {len(found)} cross-product edge(s), "
        f"{len(found) - len(new)} baselined, {len(new)} NEW, {len(stale)} stale baseline."
    ]
    for e in new:
        lines.append(
            f"NEW   {e['from_product']}->{e['to_product']}  {e['from']}:{e['line']} -> {e['to']}"
        )
    for e in stale:
        lines.append(f"STALE (no longer used, safe to drop)  {e['from']} -> {e['to']}")
    if not new:
        lines.append("OK: no new cross-product imports.")
    return "\n".join(lines)


def write_baseline(config_path: Path, config: dict, found: list[dict]) -> None:
    config["allowed_edges"] = [{"from": e["from"], "to": e["to"]} for e in found]
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args(argv)
    config_path = args.config or args.repo / CONFIG_REL
    config = load_config(config_path)
    found, new, stale = evaluate(args.repo, config)
    if args.write_baseline:
        write_baseline(config_path, config, found)
        print(f"Wrote {len(found)} allowed edge(s) to {config_path}")
        return 0
    print(render(found, new, stale))
    return 1 if new else 0


if __name__ == "__main__":
    sys.exit(main())
