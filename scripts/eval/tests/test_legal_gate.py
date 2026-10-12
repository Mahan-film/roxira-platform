"""Offline tests for scripts/eval/legal_gate.py (no network, no LLM, no Qdrant)."""
# ruff: noqa: RUF001
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("legal_gate", ROOT / "scripts" / "eval" / "legal_gate.py")
lg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lg)

CHEQUE = "قانون صدور چک"
AMEND = "قانون اصلاح قانون صدور چک (۱۳۹۷)"


def case(cid="c1", law=CHEQUE, arts=("12",), must=("سفید امضاء",), held=False, cat="commercial"):
    return {"id": cid, "question": "q", "expected_law": law, "expected_articles": list(arts),
            "must_include": list(must), "must_not_include": ["Gemini", "قانون کار"], "category": cat,
            "difficulty": "easy", "held_out": held, "status": "draft_needs_lawyer"}


def test_validate_requires_lawyer_answer_for_lawyer_verified():
    c = case()
    c["status"] = "lawyer_verified"
    assert any("lawyer_answer" in e for e in lg.validate([c]))
    c["lawyer_answer"] = "ok"
    assert not lg.validate([c])


def row(law, no):
    return {"law_name": law, "article_no": no}


# ---- question file -------------------------------------------------------------------------
def test_question_file_shape():
    cases = lg.load_cases()
    assert len(cases) == 70
    assert sum(c["held_out"] for c in cases) == 20
    assert not lg.validate(cases)
    assert {c["status"] for c in cases} <= {"text_verified", "needs_lawyer", "lawyer_verified"}
    # lawyer answers of 2026-10-13: items 4/5/6 verified, social security (item 7) still open
    by_id = {c["id"]: c for c in cases}
    for cid in ("lg-dsp-12", "lg-l56-10", "lg-l56-11", "lg-l62-7", "lg-fam-22"):
        assert by_id[cid]["status"] == "lawyer_verified" and by_id[cid]["lawyer_answer"]
    assert by_id["lg-soc-76"]["status"] == "needs_lawyer" and by_id["lg-soc-76"]["needs_lawyer_reason"]
    assert all(c.get("verified_by") == "auto:article_text" for c in cases if c["status"] == "text_verified")
    assert all(c.get("needs_lawyer_reason") for c in cases if c["status"] == "needs_lawyer")
    assert len({c["id"] for c in cases}) == 70
    laws = {c["expected_law"] for c in cases}
    for needle in ("تعزیرات", "دیوان عدالت اداری", "شخص ثالث", "قاچاق کالا و ارز"):
        assert any(needle in law for law in laws), needle  # the 4 ekhtebar laws


def test_must_include_phrases_come_from_the_staged_article_text():
    texts = {}
    for f in ("data/legal/phase1_canonical.jsonl", "data/legal/staged/corpus_fill_2026-10-11.jsonl",
              "data/legal/staged/corpus_fill_2026-10-11_replace_lease1376.jsonl",
              "data/legal/staged/corpus_fill_2026-10-12_ekhtebar.jsonl"):
        for line in (ROOT / f).read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            texts.setdefault((lg.norm(r["law_name"]), str(r["article_no"])), []).append(lg.norm(r["text"]))
    for c in lg.load_cases():
        blob = " ".join(texts[(lg.norm(c["expected_law"]), c["expected_articles"][0])])
        for phrase in c["must_include"]:
            assert lg.norm(phrase) in blob, (c["id"], phrase)


# ---- retrieval ----------------------------------------------------------------------------
def test_hit_rank_requires_exact_law_and_article():
    c = case()
    assert lg.hit_rank(c, [row(AMEND, "12"), row(CHEQUE, "3"), row(CHEQUE, "12")]) == 3
    assert lg.hit_rank(c, [row(AMEND, "12")]) is None  # amendment law is not the base law
    assert lg.hit_rank(c, [row(CHEQUE, 12)]) == 1  # int article numbers
    assert lg.hit_rank(c, []) is None


def test_norm_handles_digits_and_letters():
    assert lg.norm("ماده ۱۲  ي ك") == lg.norm("ماده 12 ی ک")


def test_retrieval_report_recall_and_groups():
    cases = [case("a", arts=("12",)), case("b", arts=("13",), held=True), case("c", arts=("14",), cat="labor")]
    pools = {"a": [row(CHEQUE, "12")], "b": [row("x", "1")] * 6 + [row(CHEQUE, "13")], "c": []}
    by_q = {"a": "a", "b": "b", "c": "c"}
    for c in cases:
        c["question"] = by_q[c["id"]]
    res = lg.run_retrieval(cases, lambda q, k: (pools[q], pools[q][:k]))
    rep = lg.retrieval_report(res, {"collection": "iran_laws_v3"})
    assert rep["summary"]["all"]["kept"]["recall@1"] == round(1 / 3, 4)
    assert rep["summary"]["all"]["kept"]["recall@5"] == round(1 / 3, 4)
    assert rep["summary"]["all"]["kept"]["recall@10"] == round(2 / 3, 4)
    assert rep["summary"]["held_out"]["n"] == 1 and rep["summary"]["dev"]["n"] == 2
    assert rep["by_category"]["labor"]["recall@10"] == 0.0
    assert "iran_laws_v3" in lg.render_markdown(rep)


# ---- answer -------------------------------------------------------------------------------
def basis(law=CHEQUE, no="12"):
    return [{"law_name": law, "article_no": no}]


def test_score_answer_all_checks():
    c = case()
    ok = lg.score_answer(c, {"reply": "چک سفید امضاء قابل تعقیب نیست", "statutory_basis": basis()}, 1000)
    assert ok["pass"]
    assert not lg.score_answer(c, {"reply": "نامربوط", "statutory_basis": basis()}, 1000)["include_ok"]
    bad = lg.score_answer(c, {"reply": "سفید امضاء. این را Gemini گفت", "statutory_basis": basis()}, 1000)
    assert bad["forbidden"] == ["Gemini"] and not bad["pass"]
    assert not lg.score_answer(c, {"reply": "سفید امضاء", "statutory_basis": basis(AMEND)}, 1000)["cited_ok"]
    assert not lg.score_answer(c, {"reply": "سفید امضاء", "statutory_basis": basis()}, 99999)["latency_ok"]


def test_basis_cites_by_title():
    c = case()
    assert lg.basis_cites(c, [{"title": "ماده 12 قانون صدور چک"}])
    assert not lg.basis_cites(c, [{"title": "ماده 13 قانون صدور چک"}])


def test_run_answer_respects_cost_cap():
    cases = [case(f"c{i}") for i in range(30)]
    calls = []

    def chat(q):
        calls.append(q)
        return {"reply": "سفید امضاء", "statutory_basis": basis(), "model_assigned": "cheap"}, 10.0

    res, info = lg.run_answer(cases, chat, max_cost_usd=0.05, est_cost_per_call=0.01)
    assert len(calls) == 5 and len(res) == 5 and len(info["skipped_for_cost"]) == 25
    assert info["spent_usd_estimate"] <= 0.05
    # the cap can never be raised above the hard limit
    res, info = lg.run_answer(cases, chat, max_cost_usd=10, est_cost_per_call=0.01)
    assert info["cost_cap_usd"] == lg.HARD_COST_CAP_USD


def test_run_answer_stops_on_gemini_pro_and_counts_errors():
    cases = [case(f"c{i}") for i in range(3)]

    def pro(q):
        return {"reply": "x", "statutory_basis": [], "model_assigned": "google/gemini-3-pro"}, 1.0

    res, info = lg.run_answer(cases, pro)
    assert len(res) == 1 and "Gemini Pro" in info["aborted"]

    def boom(q):
        raise OSError("down")

    res, info = lg.run_answer(cases, boom)
    assert len(res) == 3 and all(r["error"] == "OSError" and not r["pass"] for r in res)


def test_answer_report_and_markdown():
    c = case()
    r1 = lg.score_answer(c, {"reply": "سفید امضاء", "statutory_basis": basis()}, 500)
    r2 = lg.score_answer(case("c2", cat="labor"), {"reply": "", "statutory_basis": []}, 800)
    rep = lg.answer_report([r1, r2], {"cost_cap_usd": 0.05, "spent_usd_estimate": 0.006, "asked": 2,
                                      "skipped_for_cost": [], "aborted": ""})
    assert rep["summary"]["all"]["pass"] == 0.5 and rep["by_category"]["labor"]["pass"] == 0.0
    md = lg.render_markdown(rep)
    assert "Failing cases (1)" in md and "c2" in md


def test_answer_cli_requires_confirm_spend(capsys):
    assert lg.main(["answer", "--base-url", "http://127.0.0.1:1"]) == 2
    assert lg.main(["answer", "--base-url", "http://127.0.0.1:1", "--confirm-spend", "--max-cost-usd", "1"]) == 2


# ---- baseline compare ---------------------------------------------------------------------
def report_with(r5, cases=(), collection="iran_laws_v3"):
    block = {"n": 10, "kept": {"recall@5": r5}, "raw": {"recall@5": r5}}
    return {"mode": "retrieval", "generated": "t", "meta": {"collection": collection},
            "summary": {"all": block, "dev": block, "held_out": block}, "cases": list(cases)}


def test_compare_warns_only_beyond_threshold():
    base = report_with(0.8)
    lines, warn = lg.compare(base, report_with(0.76))  # -4 points
    assert not warn
    lines, warn = lg.compare(base, report_with(0.7))  # -10 points
    assert warn and any(line.startswith("WARNING") for line in lines)
    lines, warn = lg.compare(base, report_with(0.9))
    assert not warn
    lines, warn = lg.compare(None, report_with(0.9))
    assert not warn and "no baseline" in lines[1]


def test_compare_lists_lost_questions_and_collection_change():
    base = report_with(0.8, [{"id": "a", "rank_kept": 2}, {"id": "b", "rank_kept": 9}], "iran_laws_v2")
    cur = report_with(0.7, [{"id": "a", "rank_kept": None}, {"id": "b", "rank_kept": None}])
    lines, _ = lg.compare(base, cur)
    text = "\n".join(lines)
    assert "left the top 5: a" in text and "b" not in text.split("left the top 5:")[1].split("\n")[0]
    assert "collection changed iran_laws_v2 -> iran_laws_v3" in text


def test_extract_report_from_noisy_output(tmp_path, capsys):
    rep = report_with(0.5)
    noisy = "loading model...\nwarn\n" + lg.MARKER + " " + json.dumps(rep) + "\n"
    assert lg.extract_report(noisy)["summary"]["all"]["kept"]["recall@5"] == 0.5
    assert lg.extract_report(json.dumps(rep))["mode"] == "retrieval"
    f = tmp_path / "cur.txt"
    f.write_text(noisy, encoding="utf-8")
    assert lg.main(["compare", "--baseline", str(tmp_path / "none.json"), "--current", str(f)]) == 0
    f.write_text("garbage", encoding="utf-8")
    assert lg.main(["compare", "--baseline", str(tmp_path / "none.json"), "--current", str(f)]) == 0
    assert "skipped" in capsys.readouterr().out


def test_capture_writes_baseline_from_stdin(tmp_path, monkeypatch, capsys):
    import io

    rep = report_with(0.6)
    rep["n"] = 10
    monkeypatch.setattr("sys.stdin", io.StringIO("noise\n" + lg.MARKER + " " + json.dumps(rep) + "\n"))
    out = tmp_path / "b" / "base.json"
    assert lg.main(["capture", "--out", str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["summary"]["all"]["kept"]["recall@5"] == 0.6
    assert "60.0%" in capsys.readouterr().out
