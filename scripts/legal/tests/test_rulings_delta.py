"""Offline tests for scripts/legal/rulings_delta.py using the real ruling 883 law_watch records
(short version 2026-10-27, edited long version 2026-11-01, clipped) and the real corpus row of ruling 882.

Run ONLY this file:  python3 -m pytest scripts/legal/tests/test_rulings_delta.py
"""
# ruff: noqa: RUF001
import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FIX = Path(__file__).parent / "fixtures" / "rulings_delta"


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


rd = _load("rulings_delta", "scripts/legal/rulings_delta.py")
fu = rd._fu()


def _staged(tmp_path, *, drop=()):
    d = tmp_path / "staged"
    d.mkdir()
    for f in FIX.glob("*.jsonl"):
        if f.name not in drop:
            shutil.copy(f, d / f.name)
    return d


def _run(d, **kw):
    return rd.compute(d, kw.pop("extra", []), kw.pop("date", None), d)


def test_883_is_extracted_with_number_date_and_ascii_digits(tmp_path):
    res = _run(_staged(tmp_path))
    rows = res["rows"]
    assert [r["number"] for r in rows] == ["883"]
    r = rows[0]
    assert r["ruling_type"] == "unity_supreme_court" and r["issuing_body"] == fu.BODY_SC
    assert r["date"] == "1405/07/21" and r["date_iso"] == "2026-10-13"
    assert r["ruling_id"] == "sc-unity-883-2026-10-13" and r["post_id"] == 152392
    for k in ("title", "subject", "holding", "text", "date", "number"):
        assert not re.search(r"[۰-۹٠-٩]", r[k]), k
    assert "غیر تاجر" in r["holding"] and "خسارت تأخیر" in r["holding"].replace("تاخیر", "تأخیر")
    assert r["needs_review"] is False


def test_newest_version_wins_and_row_matches_corpus_schema(tmp_path):
    r = _run(_staged(tmp_path))["rows"][0]
    assert r["wp_modified"] == "2026-11-01T08:34:12"  # the edited version, not the 2026-10-27 one
    assert "مقدمه" in r["text"]  # long body of the edited version is kept after the holding
    corpus_row = json.loads((FIX / "unity_rulings_2026-10-12.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert set(r) == set(corpus_row)


def test_dedupe_against_corpus_882_not_duplicated(tmp_path):
    d = _staged(tmp_path)
    # a (synthetic) watch record of ruling 882 must be dropped because the corpus already has 882
    rec = json.loads((FIX / "law_watch_2026-10-27.jsonl").read_text(encoding="utf-8").splitlines()[0])
    rec["change_id"] = "ekhtebar:150280"
    rec["text"] = rec["text"].replace("۸۸۳", "۸۸۲").replace("۱۴۰۵/۰۷/۲۱", "۱۴۰۵/۰۶/۱۷")
    (d / "law_watch_2026-09-30.jsonl").write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")
    res = _run(d)
    assert [r["number"] for r in res["rows"]] == ["883"]
    assert "882" in res["already_in_corpus"]


def test_dedupe_normalises_corpus_digits(tmp_path):
    d = _staged(tmp_path)
    p = d / "unity_rulings_2026-10-12.jsonl"
    rows = [json.loads(ln) for ln in p.read_text(encoding="utf-8").splitlines()]
    extra = dict(rows[0], number="۸۸۳", ruling_id="x")  # Persian digits in the corpus
    p.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in [*rows, extra]) + "\n", encoding="utf-8")
    assert _run(d)["rows"] == []


def test_rerun_is_idempotent_and_own_output_not_counted_as_corpus(tmp_path):
    d = _staged(tmp_path)
    res = _run(d)
    rd.write_rows(res["out"], res["rows"])
    first = res["out"].read_bytes()
    res2 = _run(d)
    assert res2["out"] == res["out"] and res2["rows"] == res["rows"]
    rd.write_rows(res2["out"], res2["rows"])
    assert res2["out"].read_bytes() == first
    assert res["out"].name == "unity_rulings_delta_2026-11-01.jsonl"
    # a different delta file (other date) DOES count as corpus
    other = d / "unity_rulings_delta_2026-11-02.jsonl"
    other.write_bytes(first)
    assert _run(d, date="2026-11-03")["rows"] == []


def test_announcement_without_number_is_reported_not_emitted(tmp_path):
    res = _run(_staged(tmp_path))
    assert any("153425" in s for s in res["skipped"]["no_number"])


def test_truncated_without_holding_falls_back_to_excerpt_needs_review(tmp_path):
    d = _staged(tmp_path, drop=("law_watch_2026-10-27.jsonl",))  # only the edited long version remains
    res = _run(d)
    assert [r["number"] for r in res["rows"]] == ["883"]
    assert res["rows"][0]["needs_review"] is True


def test_extract_holding_section_c():
    text = (
        "فهرست Toggle مقدمه ج) رأی وحدت رویه شماره 12 ـ 1400/01/05 هیأت عمومی دیوان عالی کشور "
        "رای وحدت رویه شماره ۱۲ – ۱۴۰۰/۰۱/۰۵ هیات عمومی دیوان عالی کشور مقدمه جلسه تشکیل شد. "
        "ج) رأی وحدت رویه شماره 12 ـ 1400/01/05 هیأت عمومی دیوان عالی کشور "
        "طبق ماده ۱ این قانون خسارت قابل مطالبه است و رأی صادره صحیح و قانونی تشخیص داده می شود. هیأت عمومی دیوان عالی کشور"
    )
    holding, body, how = rd.extract_holding(text)
    assert how == "section_c" and holding.startswith("طبق ماده 1 این قانون") and holding.endswith("تشخیص داده می شود.")
    assert body.startswith("مقدمه")
