"""Offline unit tests for T249 async Persian NLI faithfulness audit (#988).

Uses mock NLI/cosine scorers; zero network calls, zero ONNX weight downloads,
and zero import-time side effects (LESSONS.md #33).
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts/ops/ci_box/nli_faithfulness_audit.py"
CONFIG_PATH = ROOT / "config/nli_faithfulness.json"


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestNliFaithfulnessAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nli = _load_module("nli_faithfulness_audit", SCRIPT_PATH)

    def test_config_loads_and_enforces_permissive_licenses(self):
        cfg = self.nli.load_config(CONFIG_PATH)
        self.assertEqual(cfg["nli_model"]["license"], "MIT")
        self.assertEqual(cfg["cosine_fallback_model"]["license"], "MIT")
        self.assertIn("entailment_threshold", cfg["thresholds"])

    def test_split_answer_into_claims_preserves_decimals_and_drops_short_fragments(self):
        answer = (
            "۱. مطابق ماده ۱۰.۵ قانون کار، ساعت کار روزانه ۸ ساعت است.\n"
            "۲. کارفرما مکلف به پرداخت اضافه کار به میزان ۴۰ درصد می‌باشد؛ این امر الزامی است.\n"
            "کوتاه.\n"
        )
        claims = self.nli.split_answer_into_claims(answer, min_chars=12, max_chars=400)
        self.assertEqual(len(claims), 3)
        self.assertIn("۱۰.۵", claims[0])
        self.assertIn("کارفرما", claims[1])
        self.assertIn("الزامی", claims[2])

    def test_nli_and_cosine_paraphrase_fallback_verdicts(self):
        thresholds = {
            "entailment_threshold": 0.55,
            "contradiction_threshold": 0.45,
            "cosine_fallback_threshold": 0.65,
            "min_claim_chars": 10,
            "max_claim_chars": 400,
        }

        def mock_nli(premise: str, hypothesis: str) -> dict[str, float]:
            if "۸ ساعت" in hypothesis:
                return {"entailment": 0.85, "neutral": 0.10, "contradiction": 0.05}
            if "۱۲ ساعت" in hypothesis:
                return {"entailment": 0.05, "neutral": 0.15, "contradiction": 0.80}
            return {"entailment": 0.30, "neutral": 0.55, "contradiction": 0.15}

        def mock_cosine(premise: str, hypothesis: str) -> float:
            return 0.78 if "مترادف" in hypothesis else 0.25

        chunks = ["مطابق قانون کار مدت کار روزانه ۸ ساعت است."]
        answer = (
            "مدت کار روزانه ۸ ساعت است. "
            "عبارت مترادف برای ساعت کاری روزانه نیز صدق می‌کند. "
            "ساعت کاری روزانه ۱۲ ساعت تعیین شده است. "
            "این ادعا هیچ ارتباطی به متن قانون ندارد."
        )
        audit = self.nli.audit_answer_claims(
            "ans-1", answer, chunks, mock_nli, mock_cosine, thresholds
        )
        self.assertEqual(audit["total_claims"], 4)
        verdicts = [c["verdict"] for c in audit["claims"]]
        self.assertEqual(
            verdicts,
            ["supported", "supported_paraphrase", "contradicted", "unsupported"],
        )
        self.assertEqual(audit["supported_claims"], 2)
        self.assertEqual(audit["contradicted_claims"], 1)
        self.assertEqual(audit["unsupported_claims"], 1)

    def test_50_hand_labeled_claims_precision_recall_and_calibration(self):
        # 50 synthetic hand-labeled claims: 30 entailed, 20 unsupported
        records = []
        for i in range(30):
            records.append(
                {
                    "premise": f"حکم قانونی شماره {i} درباره مالیات بر ارزش افزوده.",
                    "claim": f"ENTAIL_{i}",
                    "label": "entailed",
                }
            )
        for i in range(20):
            records.append(
                {
                    "premise": f"حکم قانونی شماره {i} درباره مالیات.",
                    "claim": f"UNSUP_{i}",
                    "label": "unsupported",
                }
            )

        def mock_nli(_premise: str, hypothesis: str) -> dict[str, float]:
            if hypothesis.startswith("ENTAIL_"):
                return {"entailment": 0.72, "neutral": 0.20, "contradiction": 0.08}
            return {"entailment": 0.22, "neutral": 0.65, "contradiction": 0.13}

        def mock_cosine(_premise: str, hypothesis: str) -> float:
            return 0.40

        thresholds = {
            "entailment_threshold": 0.55,
            "contradiction_threshold": 0.45,
            "cosine_fallback_threshold": 0.65,
        }
        metrics = self.nli.evaluate_labeled_claims(records, mock_nli, mock_cosine, thresholds)
        self.assertEqual(metrics["total"], 50)
        self.assertEqual(metrics["precision"], 1.0)
        self.assertEqual(metrics["recall"], 1.0)
        self.assertEqual(metrics["f1"], 1.0)

        cal = self.nli.calibrate_thresholds(records, mock_nli, mock_cosine, thresholds)
        self.assertEqual(cal["metrics"]["f1"], 1.0)

    def test_merge_into_nightly_report_and_dry_run_cli(self):
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            nightly = td_path / "nightly_report.json"
            nightly.write_text(json.dumps({"recall_at_5": 0.94}), encoding="utf-8")

            eval_answers = td_path / "answers.jsonl"
            eval_answers.write_text(
                json.dumps(
                    {
                        "id": "q1",
                        "answer": "مدت کار روزانه هشت ساعت است و اضافه کار چهل درصد است.",
                        "cited_chunks": ["مدت کار روزانه هشت ساعت است و اضافه کار چهل درصد است."],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            cmd = [
                sys.executable,
                str(SCRIPT_PATH),
                "--config",
                str(CONFIG_PATH),
                "--eval-answers",
                str(eval_answers),
                "--nightly-report",
                str(nightly),
                "--dry-run",
                "--json",
            ]
            out = subprocess.check_output(cmd, text=True)
            parsed = json.loads(out)
            self.assertEqual(parsed["mode"], "dry-run")
            self.assertEqual(parsed["answers_audited"], 1)

            updated = json.loads(nightly.read_text(encoding="utf-8"))
            self.assertEqual(updated["recall_at_5"], 0.94)
            self.assertIn("nli_faithfulness", updated)
            self.assertEqual(updated["nli_faithfulness"]["answers_audited"], 1)


if __name__ == "__main__":
    unittest.main()
