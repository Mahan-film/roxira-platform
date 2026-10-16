# ruff: noqa: E501
"""Offline tests for scripts/global/my_law (synthetic text only, no real Act text, no network)."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
MYLAW = ROOT / "scripts" / "global" / "my_law"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


pa = _load("my_law_parse_act", MYLAW / "parse_act.py")
fa = _load("my_law_fetch_acts", MYLAW / "fetch_acts.py")

LONG_PARA = " ".join(f"The sample person shall record item {i} in the register." for i in range(60))

PAGE1 = """\
LAWS OF MALAYSIA

REPRINT

Act 999

SAMPLE WIDGETS ACT 1999

Incorporating all amendments up to 1 March 2020

PUBLISHED BY
THE COMMISSIONER OF LAW REVISION, MALAYSIA
""".splitlines()

PAGE2 = """\
Laws of Malaysia                                                  ACT 999
                                                   2

                        ARRANGEMENT OF SECTIONS

PART I
PRELIMINARY
1.   Short title
2.   Interpretation
12.  Registration of widgets
""".splitlines()

PAGE3 = """\
Laws of Malaysia                                                  ACT 999
                                                   3
LAWS OF MALAYSIA

Act 999

SAMPLE WIDGETS ACT 1999

An Act to regulate widgets.

[1 January 2000]

ENACTED by the Parliament of Malaysia as follows:

PART I

PRELIMINARY

Short title
1. This Act may be cited as the Sample Widgets Act 1999.

Interpretation
2. In this Act, unless the context otherwise requires--
    "widget" means a thing of the kind described in the Schedule;
    "registrar" means the person appointed under this Act.

                                                       Sample Widgets 3
""".splitlines()

PAGE4 = """\
Laws of Malaysia                                                  ACT 999
                                                   4
PART II

REGISTRATION

Registration of widgets
12. (1) A person who makes a widget shall register it
    with the registrar within thirty days.
    (2) The registration shall state--
        (a) the name of the maker; and
        (b) the date of manufacture.

Illustration

A makes a widget on 1 June. A registers it on 20 June. A has complied.

Explanation.--A day means a calendar day.

Additional registration
12A. (1) The registrar may require a second registration
    where a widget is altered.
    (2) Nothing in this section applies to a spare part.

                                                       Sample Widgets 4
""".splitlines()

PAGE5 = f"""\
Laws of Malaysia                                                  ACT 999
                                                   5
Repealed provision
13. (Repealed by Act A1).

Records
14. (1) {LONG_PARA}
    (2) A short second subsection.

FIRST SCHEDULE

1. This numbered paragraph belongs to the schedule and must not become a section.

                                                       Sample Widgets 5
""".splitlines()


def fixture_text() -> str:
    return "\f".join("\n".join(p) for p in (PAGE1, PAGE2, PAGE3, PAGE4, PAGE5))


@pytest.fixture(scope="module")
def parsed():
    return pa.parse_text(fixture_text(), source_url="https://example.invalid/act999.pdf")


def by_label(rows):
    return {r["article_label"]: r for r in rows}


def test_meta_detected_from_cover():
    meta = pa.detect_meta(fixture_text())
    assert meta["act_no"] == 999
    assert meta["title"] == "Sample Widgets Act 1999"
    assert meta["reprint_date"] == "2020-03-01"


def test_cover_and_toc_dropped(parsed):
    rows, _ = parsed
    assert all("ARRANGEMENT" not in r["text"] and "PUBLISHED BY" not in r["text"] for r in rows)
    assert [r["section_no"] for r in rows if r["chunk_index"] == 0] == ["1", "2", "12", "12A", "14"]


def test_header_footer_and_page_numbers_removed(parsed):
    rows, _ = parsed
    for r in rows:
        assert "Laws of Malaysia" not in r["text"]
        assert "Sample Widgets 3" not in r["text"] and "Sample Widgets 4" not in r["text"]


def test_section_numbering_with_letters(parsed):
    labels = by_label(parsed[0])
    assert "Section 12A" in labels and "Section 12" in labels
    r = labels["Section 12A"]
    assert r["article_no"] == "12-a"
    assert r["heading"] == "Additional registration"
    assert r["text"].startswith("Section 12A Sample Widgets Act 1999: Additional registration — (1) The registrar")


def test_headings_attach_to_following_section_not_previous(parsed):
    labels = by_label(parsed[0])
    assert labels["Section 1"]["heading"] == "Short title"
    assert labels["Section 2"]["heading"] == "Interpretation"
    assert "Additional registration" not in labels["Section 12"]["text"]
    assert "Interpretation" not in labels["Section 1"]["text"]


def test_part_headings_tracked_and_kept_out_of_text(parsed):
    labels = by_label(parsed[0])
    assert labels["Section 1"]["part"].startswith("PART I")
    assert labels["Section 12"]["part"].startswith("PART II")
    assert "REGISTRATION" not in labels["Section 12"]["text"]


def test_subsections_illustrations_explanation_on_own_lines(parsed):
    body = by_label(parsed[0])["Section 12"]["text"]
    lines = body.split("\n")
    assert any(ln.startswith("(2) The registration shall state--") for ln in lines)
    assert any(ln.startswith("(a) the name of the maker; and") for ln in lines)
    assert any(ln.startswith("Illustration") for ln in lines)
    assert any(ln.startswith("Explanation.--A day") for ln in lines)
    # wrapped line is joined
    assert "register it with the registrar within thirty days." in body


def test_repealed_and_schedule_not_emitted(parsed):
    rows, stats = parsed
    assert "13" not in {r["article_no"] for r in rows}
    assert stats["skipped_repealed"] == 1
    assert not any("belongs to the schedule" in r["text"] for r in rows)


def test_row_schema_fields(parsed):
    r = by_label(parsed[0])["Section 1"]
    assert r["law_name"] == "Sample Widgets Act 1999"
    assert r["law_type"] == "STATUTE"
    assert r["status"] == "VALID" and r["is_active"] is True
    assert r["source_tier"] == "official"
    assert r["source"] == "lom.agc.gov.my (internal eval)"
    assert r["source_url"] == "https://example.invalid/act999.pdf"
    assert r["approval_date"] == "2020-03-01" and r["reprint_date"] == "2020-03-01"
    assert r["chunk_index"] == 0 and r["act_no"] == 999


def test_long_section_is_chunked(parsed):
    rows, _ = parsed
    chunks = [r for r in rows if r["section_no"] == "14"]
    assert len(chunks) >= 2
    assert [c["chunk_index"] for c in chunks] == list(range(len(chunks)))
    assert all(len(c["text"]) <= pa.MAX_CHUNK for c in chunks)
    assert all(c["chunk_count"] == len(chunks) for c in chunks)
    assert chunks[0]["article_label"] == "Section 14"
    assert chunks[1]["article_label"] == "Section 14 (part 2)"
    # every chunk repeats the citation prefix so it is retrievable alone
    assert all(c["text"].startswith("Section 14 Sample Widgets Act 1999: Records — ") for c in chunks)
    assert "A short second subsection." in chunks[-1]["text"]


def test_split_chunks_hard_splits_a_single_huge_word_run():
    body = " ".join(["word"] * 1000)
    parts = pa.split_chunks("P: ", body)
    assert len(parts) > 1 and all(len("P: " + p) <= pa.MAX_CHUNK for p in parts)


def test_numbered_list_item_does_not_start_section():
    text = fixture_text().replace(
        "    (2) The registration shall state--", "    (2) The registration shall state--\n2. a stray list item", 1
    )
    rows, stats = pa.parse_text(text)
    assert stats["rejected_numbering"] >= 1
    assert [r["section_no"] for r in rows if r["chunk_index"] == 0] == ["1", "2", "12", "12A", "14"]


def test_rows_pass_existing_ingest_gates(parsed):
    ip = _load("my_law_ingest_pipeline", ROOT / "scripts" / "legal" / "ingest_pipeline.py")
    allow = ip.load_allowlist(MYLAW / "allowlist_my_law.json")
    rows = [dict(r, law_name="Contracts Act 1950") for r in parsed[0]]
    report = ip.validate_rows(rows, allow)
    blocked = {g: v for g, v in report["blocked_rows"].items() if v}
    assert blocked == {}


def test_acts_yaml_has_twenty_pilot_acts():
    acts = fa.load_acts(MYLAW / "acts.yaml")
    assert len(acts) == 20
    assert len({a["act_no"] for a in acts}) == 20
    assert all(a["url"] is None for a in acts)
    allow = json.loads((MYLAW / "allowlist_my_law.json").read_text())
    assert {x["name"] for x in allow["laws"]} == {a["title"] for a in acts}


# ------------------------------------------------------------------ fetcher (fake network)
class FakeResp:
    def __init__(self, status, body=b"", headers=None):
        self.status, self._b, self.headers = status, body, headers or {}

    def read(self, n=-1):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    def __init__(self, routes):
        self.routes, self.calls = routes, []

    def open(self, req, timeout=0):
        self.calls.append(req.full_url)
        status, body = self.routes[req.full_url]
        if status >= 400:
            import urllib.error

            raise urllib.error.HTTPError(req.full_url, status, "x", {}, __import__("io").BytesIO(body))
        return FakeResp(status, body)


class Clock:
    def __init__(self):
        self.t, self.slept = 0.0, []

    def now(self):
        return self.t

    def sleep(self, s):
        self.slept.append(s)
        self.t += s


def _acts_file(tmp_path, urls):
    lines = ["acts:"] + [f"  - {{act_no: {n}, title: \"Act {n}\", url: \"{u}\"}}" for n, u in urls]
    p = tmp_path / "acts.yaml"
    p.write_text("\n".join(lines) + "\n")
    return p


def _args(tmp_path, acts, **kw):
    import argparse

    d = dict(acts=acts, out=tmp_path / "raw", only=[], delay=10.0, refresh=False, dry_run=False,
             robots_unreadable_ok=False)
    d.update(kw)
    return argparse.Namespace(**d)


def _fetcher(routes):
    clk = Clock()
    op = FakeOpener(routes)
    return fa.Fetcher("UA-test", opener=op, sleep=clk.sleep, clock=clk.now), op, clk


H = "https://host.invalid"


def test_user_agent_requires_contact_env():
    with pytest.raises(fa.Refusal):
        fa.user_agent({})
    assert "a@b.example" in fa.user_agent({"ROXIRA_FETCH_CONTACT": "a@b.example"})


def test_fetch_ok_records_manifest_and_rate_limits(tmp_path):
    pdf = b"%PDF-1.4 synthetic"
    f, op, clk = _fetcher({f"{H}/robots.txt": (200, b"User-agent: *\nAllow: /\n"),
                           f"{H}/a.pdf": (200, pdf), f"{H}/b.pdf": (200, pdf + b"2")})
    acts = _acts_file(tmp_path, [(1, f"{H}/a.pdf"), (2, f"{H}/b.pdf")])
    assert fa.run(_args(tmp_path, acts), fetcher=f) == fa.EXIT_OK
    man = json.loads((tmp_path / "raw" / "manifest.json").read_text())
    e = man["files"]["act_1.pdf"]
    assert e["source_url"] == f"{H}/a.pdf" and len(e["sha256"]) == 64 and e["fetched_at"].endswith("Z")
    assert (tmp_path / "raw" / "act_1.pdf").read_bytes() == pdf
    assert clk.slept and all(s >= 9.99 for s in clk.slept) and len(clk.slept) == 2  # 3 requests, 2 waits
    # second run uses the cache and makes no request
    n = len(op.calls)
    assert fa.run(_args(tmp_path, acts), fetcher=f) == fa.EXIT_OK
    assert op.calls[n:] == [f"{H}/robots.txt"]


def test_robots_disallow_refuses(tmp_path):
    f, op, _ = _fetcher({f"{H}/robots.txt": (200, b"User-agent: *\nDisallow: /\n")})
    acts = _acts_file(tmp_path, [(1, f"{H}/a.pdf")])
    assert fa.run(_args(tmp_path, acts), fetcher=f) == fa.EXIT_REFUSED
    assert f"{H}/a.pdf" not in op.calls


def test_robots_unreadable_refuses_unless_flag(tmp_path):
    routes = {f"{H}/robots.txt": (500, b"err"), f"{H}/a.pdf": (200, b"%PDF-1.4 x")}
    acts = _acts_file(tmp_path, [(1, f"{H}/a.pdf")])
    f, op, _ = _fetcher(routes)
    assert fa.run(_args(tmp_path, acts), fetcher=f) == fa.EXIT_REFUSED
    assert f"{H}/a.pdf" not in op.calls
    f2, op2, _ = _fetcher(routes)
    assert fa.run(_args(tmp_path, acts, robots_unreadable_ok=True), fetcher=f2) == fa.EXIT_OK
    assert f"{H}/a.pdf" in op2.calls


@pytest.mark.parametrize("status,body", [(403, b"Forbidden"), (429, b""), (200, b"<html>Just a moment... captcha</html>"),
                                         (200, b"<html>not a pdf</html>")])
def test_block_or_challenge_stops_without_retry(tmp_path, status, body):
    f, op, _ = _fetcher({f"{H}/robots.txt": (404, b""), f"{H}/a.pdf": (status, body),
                         f"{H}/b.pdf": (200, b"%PDF-1.4 b")})
    acts = _acts_file(tmp_path, [(1, f"{H}/a.pdf"), (2, f"{H}/b.pdf")])
    assert fa.run(_args(tmp_path, acts), fetcher=f) == fa.EXIT_STOPPED
    assert op.calls.count(f"{H}/a.pdf") == 1          # no retry
    assert f"{H}/b.pdf" not in op.calls               # run stopped


def test_null_url_acts_are_skipped_and_dry_run_has_no_network(tmp_path):
    acts = _acts_file(tmp_path, [(1, f"{H}/a.pdf")])
    assert fa.run(_args(tmp_path, acts, dry_run=True), fetcher=None) == fa.EXIT_OK
    assert fa.run(_args(tmp_path, MYLAW / "acts.yaml"), fetcher=None) == fa.EXIT_OK
