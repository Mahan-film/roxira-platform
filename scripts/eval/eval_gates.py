#!/usr/bin/env python3
"""R25 Eval Harness Gates (T268): golden splits, per-PR deterministic gate, nightly judge, and voice gap.

Implements the four R25 evaluation harness gates:
1. Golden set schema with frozen ``corpus_snapshot``, ISO ``as_of_date``, and disjoint
   ``dev`` / ``calibration`` / ``sealed`` splits (with optional SHA-256 sealed-hash manifest).
2. Per-PR deterministic gate: runs offline in under 3 minutes with zero LLM cost.
3. Nightly judge runner: resolves the pinned judge model id from ``config/models.yaml``
   (never hardcoded) and enforces a hard USD cost cap.
4. Paired voice subset evaluation: reports clean-vs-transcript Recall@5 and their gap.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol, Sequence

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODELS_YAML = REPO_ROOT / "config" / "models.yaml"
SPLITS: tuple[str, ...] = ("dev", "calibration", "sealed")
CASE_CLASSES: tuple[str, ...] = ("exact_recall", "as_of", "false_premise", "out_of_scope")
PR_GATE_MAX_SECONDS: float = 180.0

_TRANS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_EXTRA = str.maketrans({"ي": "ی", "ك": "ک", "\u00ad": "", "\u200f": "", "\u200e": ""})


class Retriever(Protocol):
    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        ...


def normalize_text(text: Any) -> str:
    """Deterministic Persian/Arabic/digit normalisation for offline eval matching."""
    t = str(text or "").translate(_EXTRA).translate(_TRANS).replace("\u200c", " ")
    return re.sub(r"\s+", " ", t).strip().lower()


def _is_valid_iso_date(value: Any) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.strip()):
        return False
    try:
        date.fromisoformat(value.strip())
    except ValueError:
        return False
    return True


def validate_golden_manifest(manifest: dict[str, Any]) -> list[str]:
    """Validate R25 golden-set schema: frozen snapshot, as-of date, and disjoint splits."""
    errors: list[str] = []
    if not isinstance(manifest, dict):
        return ["manifest must be a JSON object"]

    schema_ver = manifest.get("schema_version")
    if not isinstance(schema_ver, int) or schema_ver < 1:
        errors.append("schema_version must be an integer >= 1")

    snapshot = str(manifest.get("corpus_snapshot") or "").strip()
    if not snapshot:
        errors.append("corpus_snapshot is required (frozen corpus snapshot id/hash)")

    manifest_as_of = manifest.get("as_of_date")
    if not _is_valid_iso_date(manifest_as_of):
        errors.append(f"invalid manifest as_of_date: {manifest_as_of!r} (expected YYYY-MM-DD)")

    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        errors.append("cases must be a non-empty list")
        return errors

    seen_ids: set[str] = set()
    split_counts: dict[str, int] = {s: 0 for s in SPLITS}
    questions_by_split: dict[str, set[str]] = {s: set() for s in SPLITS}

    for idx, case in enumerate(cases):
        if not isinstance(case, dict):
            errors.append(f"cases[{idx}] must be an object")
            continue
        cid = str(case.get("id") or "").strip()
        if not cid:
            errors.append(f"cases[{idx}]: missing id")
        elif cid in seen_ids:
            errors.append(f"duplicate case id: {cid}")
        seen_ids.add(cid)

        split = case.get("split")
        if split not in SPLITS:
            errors.append(f"{cid or idx}: split must be one of {SPLITS}, got {split!r}")
        else:
            split_counts[split] += 1

        question = str(case.get("question") or "").strip()
        if not question:
            errors.append(f"{cid or idx}: empty question")
        elif split in SPLITS:
            questions_by_split[split].add(normalize_text(question))

        case_as_of = case.get("as_of_date")
        if case_as_of is not None and not _is_valid_iso_date(case_as_of):
            errors.append(f"{cid or idx}: invalid as_of_date {case_as_of!r}")

        c_class = case.get("case_class", "exact_recall")
        if c_class not in CASE_CLASSES:
            errors.append(f"{cid or idx}: unknown case_class {c_class!r}")

        if c_class not in ("false_premise", "out_of_scope"):
            if not str(case.get("expected_law") or "").strip():
                errors.append(f"{cid or idx}: empty expected_law")
            arts = case.get("expected_articles")
            if not isinstance(arts, list) or not arts:
                errors.append(f"{cid or idx}: expected_articles must be a non-empty list")

    # Enforce split hygiene: sealed questions must not overlap with dev or calibration.
    sealed_qs = questions_by_split["sealed"]
    for other in ("dev", "calibration"):
        overlap = sealed_qs & questions_by_split[other]
        if overlap:
            errors.append(f"sealed split leaks {len(overlap)} question(s) into {other}")

    # Optional sealed_hashes integrity check when provided.
    sealed_hashes = manifest.get("sealed_hashes")
    if sealed_hashes is not None:
        if not isinstance(sealed_hashes, list) or not all(isinstance(h, str) and len(h) == 64 for h in sealed_hashes):
            errors.append("sealed_hashes must be a list of 64-char sha256 hex strings")
        elif split_counts["sealed"] > 0:
            computed = {
                hashlib.sha256(f"{c['id']}::{c['question']}".encode("utf-8")).hexdigest()
                for c in cases
                if c.get("split") == "sealed"
            }
            if set(sealed_hashes) != computed:
                errors.append("sealed_hashes mismatch against sealed split cases")

    return errors


def _row_matches_case(case: dict[str, Any], row: dict[str, Any]) -> bool:
    want_law = normalize_text(case.get("expected_law"))
    got_law = normalize_text(row.get("law_name") or row.get("law") or row.get("title"))
    if not want_law or want_law != got_law:
        return False
    want_arts = {str(a).strip() for a in (case.get("expected_articles") or [])}
    got_art = str(row.get("article_no") or row.get("article") or "").strip()
    return got_art in want_arts


def evaluate_retrieval_split(
    cases: Sequence[dict[str, Any]],
    retriever: Retriever,
    *,
    top_k: int = 5,
) -> dict[str, Any]:
    """Run deterministic retrieval Recall@k and p95 latency on a split."""
    eligible = [c for c in cases if c.get("case_class", "exact_recall") not in ("false_premise", "out_of_scope")]
    hits = 0
    latencies_ms: list[float] = []

    for case in eligible:
        t0 = time.perf_counter()
        rows = retriever.search(case["question"], top_k=top_k)
        latencies_ms.append((time.perf_counter() - t0) * 1000.0)
        if any(_row_matches_case(case, r) for r in rows[:top_k]):
            hits += 1

    latencies_ms.sort()
    p95_idx = max(0, math.ceil(0.95 * len(latencies_ms)) - 1) if latencies_ms else 0
    p95_ms = round(latencies_ms[p95_idx], 3) if latencies_ms else 0.0
    total = len(eligible)
    return {
        "n": total,
        "hits_at_k": hits,
        f"recall_at_{top_k}": round(hits / total, 4) if total else 0.0,
        "p95_ms": p95_ms,
    }


def evaluate_voice_subset(
    pairs: Sequence[dict[str, Any]],
    retriever: Retriever,
    *,
    top_k: int = 5,
) -> dict[str, Any]:
    """Evaluate paired clean vs. STT-transcript questions and report Recall@k gap."""
    clean_hits = 0
    transcript_hits = 0
    per_pair: list[dict[str, Any]] = []

    for pair in pairs:
        clean_q = str(pair.get("clean_question") or pair.get("question") or "").strip()
        transcript_q = str(pair.get("transcript_question") or pair.get("stt_heard") or "").strip()
        if not clean_q or not transcript_q:
            raise ValueError(f"voice pair {pair.get('id')!r} must have clean and transcript questions")

        expected_articles = pair.get("expected_articles")
        if expected_articles is None and pair.get("expected_article") is not None:
            expected_articles = [pair["expected_article"]]
        case_stub = {
            "expected_law": pair.get("expected_law", ""),
            "expected_articles": expected_articles or [],
        }

        clean_rows = retriever.search(clean_q, top_k=top_k)[:top_k]
        trans_rows = retriever.search(transcript_q, top_k=top_k)[:top_k]
        c_hit = any(_row_matches_case(case_stub, r) for r in clean_rows)
        t_hit = any(_row_matches_case(case_stub, r) for r in trans_rows)
        if c_hit:
            clean_hits += 1
        if t_hit:
            transcript_hits += 1
        per_pair.append({"id": pair.get("id"), "clean_hit": c_hit, "transcript_hit": t_hit})

    n = len(pairs)
    clean_recall = round(clean_hits / n, 4) if n else 0.0
    transcript_recall = round(transcript_hits / n, 4) if n else 0.0
    gap = round(clean_recall - transcript_recall, 4)
    return {
        "n_pairs": n,
        "top_k": top_k,
        f"clean_recall_at_{top_k}": clean_recall,
        f"transcript_recall_at_{top_k}": transcript_recall,
        f"recall_gap_at_{top_k}": gap,
        "pairs": per_pair,
    }


def extract_voice_pairs(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract paired voice subset entries from manifest['voice_pairs'] or case['stt_heard']."""
    explicit = manifest.get("voice_pairs")
    if isinstance(explicit, list) and explicit:
        return list(explicit)
    pairs: list[dict[str, Any]] = []
    for case in manifest.get("cases") or []:
        stt = str(case.get("stt_heard") or "").strip()
        if stt:
            pairs.append({
                "id": case["id"],
                "clean_question": case["question"],
                "transcript_question": stt,
                "expected_law": case.get("expected_law", ""),
                "expected_articles": case.get("expected_articles", []),
            })
    return pairs


def run_pr_gate(
    manifest: dict[str, Any],
    retriever: Retriever,
    *,
    top_k: int = 5,
    max_seconds: float = PR_GATE_MAX_SECONDS,
    min_recall_at_5: float = 0.0,
    max_voice_gap: float = 1.0,
) -> dict[str, Any]:
    """Run the per-PR deterministic gate (no LLM calls, 0 USD, <= 180 s)."""
    t0 = time.monotonic()
    errors = validate_golden_manifest(manifest)
    split_reports: dict[str, Any] = {}
    voice_report: dict[str, Any] | None = None

    if not errors:
        cases = manifest["cases"]
        for split_name in ("dev", "calibration"):
            split_cases = [c for c in cases if c.get("split") == split_name]
            if split_cases:
                split_reports[split_name] = evaluate_retrieval_split(split_cases, retriever, top_k=top_k)

        sealed_count = sum(1 for c in cases if c.get("split") == "sealed")
        split_reports["sealed"] = {"n": sealed_count, "evaluated_in_pr_gate": False}

        voice_pairs = extract_voice_pairs(manifest)
        if voice_pairs:
            voice_report = evaluate_voice_subset(voice_pairs, retriever, top_k=top_k)
            gap_key = f"recall_gap_at_{top_k}"
            if voice_report[gap_key] > max_voice_gap:
                errors.append(f"voice {gap_key}={voice_report[gap_key]} exceeds max_voice_gap={max_voice_gap}")

        for split_name in ("dev", "calibration"):
            rep = split_reports.get(split_name)
            if rep and rep["n"] > 0 and rep[f"recall_at_{top_k}"] < min_recall_at_5:
                errors.append(
                    f"{split_name} recall_at_{top_k}={rep[f'recall_at_{top_k}']} < min_recall_at_5={min_recall_at_5}"
                )

    elapsed_s = round(time.monotonic() - t0, 4)
    if elapsed_s > max_seconds:
        errors.append(f"per-PR gate took {elapsed_s}s > max_seconds={max_seconds}s")

    return {
        "mode": "pr_gate",
        "passed": not errors,
        "elapsed_s": elapsed_s,
        "max_seconds": max_seconds,
        "llm_cost_usd": 0.0,
        "corpus_snapshot": manifest.get("corpus_snapshot") if isinstance(manifest, dict) else None,
        "as_of_date": manifest.get("as_of_date") if isinstance(manifest, dict) else None,
        "splits": split_reports,
        "voice_subset": voice_report,
        "errors": errors,
    }


def resolve_pinned_judge_id(
    models_yaml_path: Path = DEFAULT_MODELS_YAML,
    *,
    role: str = "reviewer",
) -> str:
    """Resolve the pinned judge model id from config/models.yaml (never hardcoded)."""
    data = yaml.safe_load(Path(models_yaml_path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("models.yaml did not parse to a mapping")

    retired_ids = {
        str(item.get("id")).strip()
        for item in (data.get("retired") or [])
        if isinstance(item, dict) and item.get("id")
    }
    roles = data.get("roles") or {}
    role_cfg = roles.get(role)
    if not isinstance(role_cfg, dict):
        raise ValueError(f"role {role!r} not found in {models_yaml_path}")

    models = role_cfg.get("models") or []
    if not models or not isinstance(models[0], dict) or not models[0].get("id"):
        raise ValueError(f"role {role!r} has no pinned primary model id in {models_yaml_path}")

    judge_id = str(models[0]["id"]).strip()
    if judge_id in retired_ids:
        raise ValueError(f"pinned judge id {judge_id!r} for role {role!r} is marked retired")
    return judge_id


def run_nightly_judge(
    manifest: dict[str, Any],
    judge_fn: Callable[[dict[str, Any], str], dict[str, Any]],
    *,
    models_yaml_path: Path = DEFAULT_MODELS_YAML,
    judge_role: str = "reviewer",
    split: str = "calibration",
    max_cost_usd: float = 0.50,
) -> dict[str, Any]:
    """Run nightly LLM-as-judge evaluation using a pinned judge id from config/models.yaml."""
    if split not in SPLITS:
        raise ValueError(f"split must be one of {SPLITS}, got {split!r}")
    errors = validate_golden_manifest(manifest)
    if errors:
        raise ValueError("invalid golden manifest: " + "; ".join(errors))

    judge_model_id = resolve_pinned_judge_id(models_yaml_path, role=judge_role)
    selected = [c for c in manifest["cases"] if c.get("split") == split]

    results: list[dict[str, Any]] = []
    spent_usd = 0.0
    skipped_for_budget = 0

    for case in selected:
        if spent_usd >= max_cost_usd:
            skipped_for_budget += 1
            continue
        verdict = judge_fn(case, judge_model_id)
        cost = float(verdict.get("cost_usd") or 0.0)
        spent_usd += cost
        results.append({
            "id": case["id"],
            "passed": bool(verdict.get("passed")),
            "score": float(verdict.get("score", 1.0 if verdict.get("passed") else 0.0)),
            "cost_usd": cost,
        })

    evaluated = len(results)
    pass_count = sum(1 for r in results if r["passed"])
    mean_score = round(sum(r["score"] for r in results) / evaluated, 4) if evaluated else 0.0
    return {
        "mode": "nightly_judge",
        "judge_role": judge_role,
        "judge_model_id": judge_model_id,
        "split": split,
        "corpus_snapshot": manifest["corpus_snapshot"],
        "as_of_date": manifest["as_of_date"],
        "evaluated": evaluated,
        "skipped_for_budget": skipped_for_budget,
        "pass_rate": round(pass_count / evaluated, 4) if evaluated else 0.0,
        "mean_score": mean_score,
        "spent_usd": round(spent_usd, 6),
        "max_cost_usd": max_cost_usd,
        "results": results,
    }


class SimpleTokenRetriever:
    """Offline deterministic token-overlap retriever for CLI smoke runs."""

    def __init__(self, docs: Iterable[dict[str, Any]]) -> None:
        self._docs = list(docs)

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        q_tokens = set(normalize_text(query).split())
        scored: list[tuple[int, dict[str, Any]]] = []
        for doc in self._docs:
            d_tokens = set(normalize_text(doc.get("text") or "").split())
            scored.append((len(q_tokens & d_tokens), doc))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [doc for _, doc in scored[:top_k]]


def _load_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="R25 eval harness gates (T268)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    v = sub.add_parser("validate", help="Validate golden manifest schema")
    v.add_argument("--manifest", required=True, type=Path)

    pr = sub.add_parser("pr-gate", help="Run deterministic per-PR gate (0 USD, <= 180s)")
    pr.add_argument("--manifest", required=True, type=Path)
    pr.add_argument("--top-k", type=int, default=5)
    pr.add_argument("--max-seconds", type=float, default=PR_GATE_MAX_SECONDS)
    pr.add_argument("--min-recall", type=float, default=0.0)
    pr.add_argument("--max-voice-gap", type=float, default=1.0)

    nj = sub.add_parser("nightly-judge", help="Resolve pinned judge id and run nightly eval")
    nj.add_argument("--manifest", required=True, type=Path)
    nj.add_argument("--models-yaml", type=Path, default=DEFAULT_MODELS_YAML)
    nj.add_argument("--role", default="reviewer")
    nj.add_argument("--split", choices=SPLITS, default="calibration")
    nj.add_argument("--dry-run", action="store_true")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    manifest = _load_manifest(args.manifest)

    if args.cmd == "validate":
        errs = validate_golden_manifest(manifest)
        print("OK" if not errs else "\n".join(errs))
        return 1 if errs else 0

    if args.cmd == "pr-gate":
        docs = [
            {
                "law_name": c.get("expected_law", ""),
                "article_no": (c.get("expected_articles") or [""])[0],
                "text": f"{c.get('question', '')} {c.get('expected_law', '')}",
            }
            for c in manifest.get("cases") or []
            if c.get("expected_law")
        ]
        rep = run_pr_gate(
            manifest,
            SimpleTokenRetriever(docs),
            top_k=args.top_k,
            max_seconds=args.max_seconds,
            min_recall_at_5=args.min_recall,
            max_voice_gap=args.max_voice_gap,
        )
        print(json.dumps(rep, ensure_ascii=False, indent=2))
        return 0 if rep["passed"] else 1

    if args.cmd == "nightly-judge":
        if not args.dry_run:
            print("live nightly-judge requires a caller-supplied judge_fn", file=sys.stderr)
            return 2
        rep = run_nightly_judge(
            manifest,
            lambda case, model_id: {"passed": True, "score": 1.0, "cost_usd": 0.0},
            models_yaml_path=args.models_yaml,
            judge_role=args.role,
            split=args.split,
        )
        print(json.dumps(rep, ensure_ascii=False, indent=2))
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
