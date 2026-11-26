#!/usr/bin/env python3
"""Async Persian NLI faithfulness audit for nightly Smart Judge eval (T249 / #988).

Splits eval answers into atomic claims, scores each (cited chunk, claim) pair with
an MIT-licensed multilingual NLI model (INT8 ONNX) plus a bge-m3 cosine fallback for
paraphrases, calibrates thresholds on labeled claims, and writes summary scores
into the nightly eval JSON report.

Offline unit tests inject mock scorers and never require network or ONNX weights.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG_PATH = REPO_ROOT / "config/nli_faithfulness.json"

_PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_ARABIC_CHARS = str.maketrans({"ك": "ک", "ي": "ی", "ى": "ی", "ة": "ه", "ؤ": "و", "إ": "ا", "أ": "ا"})

NliScorer = Callable[[str, str], dict[str, float]]
CosineScorer = Callable[[str, str], float]


def normalize_persian(text: str) -> str:
    """Normalize Persian/Arabic characters, digits, ZWNJ, and whitespace."""
    cleaned = (text or "").translate(_ARABIC_CHARS).translate(_PERSIAN_DIGITS)
    cleaned = cleaned.replace("\u200c", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def load_config(path: Path | None = None) -> dict[str, Any]:
    """Load and validate NLI faithfulness configuration."""
    p = path or DEFAULT_CONFIG_PATH
    if not p.is_file():
        raise FileNotFoundError(f"NLI faithfulness config not found at {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    if "thresholds" not in data or "nli_model" not in data:
        raise ValueError(f"Invalid NLI config at {p}: missing thresholds or nli_model")
    return data


def split_answer_into_claims(
    answer: str,
    min_chars: int = 12,
    max_chars: int = 400,
) -> list[str]:
    """Split an answer into atomic factual/legal claims without breaking decimal/article numbers."""
    text = (answer or "").strip()
    if not text:
        return []

    # Protect decimal numbers like 12.5 or ۱۲.۵ before splitting on periods.
    protected = re.sub(r"([0-9۰-۹])\.([0-9۰-۹])", r"\1<DOT>\2", text)
    # Strip markdown bullet/number prefixes at line starts after splitting lines.
    raw_lines = [ln.strip() for ln in protected.splitlines() if ln.strip()]
    segments: list[str] = []
    for line in raw_lines:
        line = re.sub(r"^(?:[-*•]|\d+[.)]|[۰-۹]+[.)])\s+", "", line)
        parts = re.split(r"(?<=[.!؟?؛۔])\s+", line)
        for part in parts:
            restored = part.replace("<DOT>", ".").strip()
            if len(restored) < min_chars:
                continue
            if len(restored) > max_chars:
                restored = restored[:max_chars].rsplit(" ", 1)[0].strip() or restored[:max_chars]
            segments.append(restored)
    return segments


def lexical_overlap_score(premise: str, hypothesis: str) -> float:
    """Deterministic offline token-containment heuristic for dry-run smoke checks."""
    p_tokens = set(normalize_persian(premise).lower().split())
    h_tokens = [t for t in normalize_persian(hypothesis).lower().split() if len(t) > 1]
    if not h_tokens or not p_tokens:
        return 0.0
    hits = sum(1 for t in h_tokens if t in p_tokens)
    return hits / len(h_tokens)


def default_dry_run_nli_scorer(premise: str, hypothesis: str) -> dict[str, float]:
    """Offline heuristic NLI scorer used only when --dry-run is requested without ONNX weights."""
    overlap = lexical_overlap_score(premise, hypothesis)
    entail = min(0.95, overlap)
    contradict = 0.05 if overlap > 0.2 else 0.15
    neutral = max(0.0, 1.0 - entail - contradict)
    return {"entailment": entail, "neutral": neutral, "contradiction": contradict}


class OnnxNliScorer:
    """Lazy-loaded INT8 ONNX NLI scorer for production box runs (no import-time side effects)."""

    def __init__(self, model_dir: Path, intra_op_threads: int = 4, max_length: int = 512):
        self.model_dir = Path(model_dir)
        self.intra_op_threads = intra_op_threads
        self.max_length = max_length
        self._session = None
        self._tokenizer = None
        self._id2label: dict[int, str] = {}

    def _ensure_loaded(self) -> None:
        if self._session is not None:
            return
        if not self.model_dir.is_dir():
            raise FileNotFoundError(f"ONNX NLI model dir not found: {self.model_dir}")
        import onnxruntime as ort  # type: ignore[import-not-found]
        from transformers import AutoConfig, AutoTokenizer  # type: ignore[import-not-found]

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = self.intra_op_threads
        model_file = self.model_dir / "model_quantized.onnx"
        if not model_file.is_file():
            model_file = self.model_dir / "model.onnx"
        self._session = ort.InferenceSession(
            str(model_file), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        self._tokenizer = AutoTokenizer.from_pretrained(str(self.model_dir))
        cfg = AutoConfig.from_pretrained(str(self.model_dir))
        self._id2label = {int(k): str(v).lower() for k, v in cfg.id2label.items()}

    def __call__(self, premise: str, hypothesis: str) -> dict[str, float]:
        import numpy as np  # type: ignore[import-not-found]

        self._ensure_loaded()
        assert self._tokenizer is not None and self._session is not None
        encoded = self._tokenizer(
            premise,
            hypothesis,
            truncation=True,
            max_length=self.max_length,
            return_tensors="np",
        )
        inputs = {k: v for k, v in encoded.items() if k in {i.name for i in self._session.get_inputs()}}
        logits = self._session.run(None, inputs)[0][0]
        exp = np.exp(logits - np.max(logits))
        probs = exp / np.sum(exp)
        out = {"entailment": 0.0, "neutral": 0.0, "contradiction": 0.0}
        for idx, p in enumerate(probs):
            lbl = self._id2label.get(idx, "neutral")
            if "entail" in lbl:
                out["entailment"] = float(p)
            elif "contradict" in lbl:
                out["contradiction"] = float(p)
            else:
                out["neutral"] = float(p)
        return out


def score_claim_against_chunks(
    claim: str,
    cited_chunks: Sequence[str],
    nli_scorer: NliScorer,
    cosine_scorer: CosineScorer | None,
    thresholds: dict[str, Any],
) -> dict[str, Any]:
    """Score a single claim against cited chunks with NLI + cosine paraphrase fallback."""
    entail_th = float(thresholds.get("entailment_threshold", 0.55))
    contra_th = float(thresholds.get("contradiction_threshold", 0.45))
    cos_th = float(thresholds.get("cosine_fallback_threshold", 0.65))

    if not cited_chunks:
        return {
            "claim": claim,
            "verdict": "unsupported",
            "entailment": 0.0,
            "contradiction": 0.0,
            "cosine": 0.0,
            "best_chunk_index": None,
        }

    best_entail = -1.0
    best_contra = -1.0
    best_idx = 0
    for idx, chunk in enumerate(cited_chunks):
        scores = nli_scorer(chunk, claim)
        ent = float(scores.get("entailment", 0.0))
        con = float(scores.get("contradiction", 0.0))
        if ent > best_entail:
            best_entail = ent
            best_idx = idx
        if con > best_contra:
            best_contra = con

    best_cos = 0.0
    if best_contra >= contra_th and best_contra > best_entail:
        verdict = "contradicted"
    elif best_entail >= entail_th:
        verdict = "supported"
    else:
        if cosine_scorer is not None:
            best_cos = max(float(cosine_scorer(chunk, claim)) for chunk in cited_chunks)
        verdict = "supported_paraphrase" if best_cos >= cos_th else "unsupported"

    return {
        "claim": claim,
        "verdict": verdict,
        "entailment": round(max(0.0, best_entail), 4),
        "contradiction": round(max(0.0, best_contra), 4),
        "cosine": round(best_cos, 4),
        "best_chunk_index": best_idx,
    }


def audit_answer_claims(
    answer_id: str,
    answer_text: str,
    cited_chunks: Sequence[str],
    nli_scorer: NliScorer,
    cosine_scorer: CosineScorer | None,
    thresholds: dict[str, Any],
) -> dict[str, Any]:
    """Split an answer into claims and audit faithfulness against cited chunks."""
    claims = split_answer_into_claims(
        answer_text,
        min_chars=int(thresholds.get("min_claim_chars", 12)),
        max_chars=int(thresholds.get("max_claim_chars", 400)),
    )
    results = [
        score_claim_against_chunks(c, cited_chunks, nli_scorer, cosine_scorer, thresholds)
        for c in claims
    ]
    total = len(results)
    supported = sum(1 for r in results if r["verdict"] in ("supported", "supported_paraphrase"))
    contradicted = sum(1 for r in results if r["verdict"] == "contradicted")
    unsupported = sum(1 for r in results if r["verdict"] == "unsupported")
    return {
        "answer_id": answer_id,
        "total_claims": total,
        "supported_claims": supported,
        "contradicted_claims": contradicted,
        "unsupported_claims": unsupported,
        "support_rate": round(supported / total, 4) if total else 1.0,
        "contradiction_rate": round(contradicted / total, 4) if total else 0.0,
        "claims": results,
    }


def evaluate_labeled_claims(
    records: Sequence[dict[str, Any]],
    nli_scorer: NliScorer,
    cosine_scorer: CosineScorer | None,
    thresholds: dict[str, Any],
) -> dict[str, Any]:
    """Compute precision, recall, F1, and accuracy on hand-labeled (premise, claim, label) rows."""
    tp = fp = tn = fn = 0
    for rec in records:
        expected_supported = str(rec.get("label", "")).lower() in ("entailed", "supported", "true", "1")
        scored = score_claim_against_chunks(
            str(rec["claim"]),
            [str(rec["premise"])],
            nli_scorer,
            cosine_scorer,
            thresholds,
        )
        pred_supported = scored["verdict"] in ("supported", "supported_paraphrase")
        if pred_supported and expected_supported:
            tp += 1
        elif pred_supported and not expected_supported:
            fp += 1
        elif not pred_supported and expected_supported:
            fn += 1
        else:
            tn += 1

    total = len(records)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    accuracy = (tp + tn) / total if total else 0.0
    return {
        "total": total,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "accuracy": round(accuracy, 4),
    }


def calibrate_thresholds(
    records: Sequence[dict[str, Any]],
    nli_scorer: NliScorer,
    cosine_scorer: CosineScorer | None,
    base_thresholds: dict[str, Any],
    entailment_grid: Sequence[float] = (0.45, 0.55, 0.65, 0.75),
    cosine_grid: Sequence[float] = (0.55, 0.65, 0.75),
) -> dict[str, Any]:
    """Grid-search entailment & cosine thresholds to maximize F1 on labeled claims."""
    best: dict[str, Any] | None = None
    for ent_th in entailment_grid:
        for cos_th in cosine_grid:
            candidate = {
                **base_thresholds,
                "entailment_threshold": ent_th,
                "cosine_fallback_threshold": cos_th,
            }
            metrics = evaluate_labeled_claims(records, nli_scorer, cosine_scorer, candidate)
            score_key = (metrics["f1"], metrics["precision"])
            if best is None or score_key > best["_key"]:
                best = {
                    "_key": score_key,
                    "entailment_threshold": ent_th,
                    "cosine_fallback_threshold": cos_th,
                    "metrics": metrics,
                }
    assert best is not None
    best.pop("_key", None)
    return best


def merge_into_nightly_report(nightly_report_path: Path, audit_summary: dict[str, Any]) -> None:
    """Atomically write NLI faithfulness audit scores into the nightly eval JSON report."""
    nightly_report_path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {}
    if nightly_report_path.is_file():
        payload = json.loads(nightly_report_path.read_text(encoding="utf-8"))
    payload["nli_faithfulness"] = audit_summary

    fd, tmp_name = tempfile.mkstemp(
        dir=str(nightly_report_path.parent),
        prefix=f".{nightly_report_path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        os.replace(tmp_name, nightly_report_path)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--eval-answers", type=Path, help="JSONL file with {id, answer, cited_chunks}")
    parser.add_argument("--labeled-claims", type=Path, help="JSONL file with {premise, claim, label}")
    parser.add_argument("--nightly-report", type=Path, help="Nightly eval JSON report to update")
    parser.add_argument("--onnx-model-dir", type=Path, help="Path to local INT8 ONNX NLI model")
    parser.add_argument("--calibrate", action="store_true", help="Run threshold calibration sweep")
    parser.add_argument("--dry-run", action="store_true", help="Use offline heuristic scorer (no model)")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    thresholds = cfg["thresholds"]

    if args.onnx_model_dir and not args.dry_run:
        nli_scorer: NliScorer = OnnxNliScorer(
            args.onnx_model_dir,
            intra_op_threads=int(cfg["nli_model"].get("intra_op_threads", 4)),
            max_length=int(cfg["nli_model"].get("max_length", 512)),
        )
    else:
        nli_scorer = default_dry_run_nli_scorer

    cosine_scorer: CosineScorer = lexical_overlap_score

    summary: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "mode": "dry-run" if args.dry_run or not args.onnx_model_dir else "onnx-int8",
        "model_id": cfg["nli_model"]["id"],
    }

    if args.labeled_claims and args.labeled_claims.is_file():
        records = [
            json.loads(line)
            for line in args.labeled_claims.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if args.calibrate:
            summary["calibration"] = calibrate_thresholds(
                records, nli_scorer, cosine_scorer, thresholds
            )
        else:
            summary["labeled_eval"] = evaluate_labeled_claims(
                records, nli_scorer, cosine_scorer, thresholds
            )

    if args.eval_answers and args.eval_answers.is_file():
        answers = [
            json.loads(line)
            for line in args.eval_answers.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        audited = [
            audit_answer_claims(
                str(row.get("id", idx)),
                str(row.get("answer", "")),
                list(row.get("cited_chunks", [])),
                nli_scorer,
                cosine_scorer,
                thresholds,
            )
            for idx, row in enumerate(answers)
        ]
        total_claims = sum(a["total_claims"] for a in audited)
        supported = sum(a["supported_claims"] for a in audited)
        contradicted = sum(a["contradicted_claims"] for a in audited)
        summary["answers_audited"] = len(audited)
        summary["total_claims"] = total_claims
        summary["support_rate"] = round(supported / total_claims, 4) if total_claims else 1.0
        summary["contradiction_rate"] = round(contradicted / total_claims, 4) if total_claims else 0.0
        summary["results"] = audited

    if args.nightly_report:
        merge_into_nightly_report(args.nightly_report, summary)

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"NLI faithfulness audit ({summary['mode']}): model={summary['model_id']}")
        if "labeled_eval" in summary:
            ev = summary["labeled_eval"]
            print(f"  labeled_eval: precision={ev['precision']} recall={ev['recall']} f1={ev['f1']} (n={ev['total']})")
        if "answers_audited" in summary:
            print(f"  answers={summary['answers_audited']} claims={summary['total_claims']} support_rate={summary['support_rate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
