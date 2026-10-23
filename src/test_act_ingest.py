"""Offline tests for scripts/legal/act_ingest.py on hand-made fixtures (no network, no Act text)."""

import functools
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@functools.cache
def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "legal" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # dataclasses look the module up while the class is created
    spec.loader.exec_module(mod)
    return mod


def _ai():
    return _load("act_ingest")


def _ip():
    return _load("ingest_pipeline")


def _my():
    return _ai().PROFILES["malaysia"]


# Mimics the layout of a Laws of Malaysia reprint as pdftotext prints it: cover, arrangement of
# sections, enacting formula, parts, marginal notes, a repealed section, running headers, page
# numbers, and a schedule. The wording is invented.
FIXTURE = """\
LAWS OF MALAYSIA
ONLINE VERSION OF UPDATED TEXT OF REPRINT
Act 9999
EXAMPLE AGREEMENTS ACT 2099
As at 1 January 2100
\f
Example Agreements
2
ARRANGEMENT OF SECTIONS
PART I
PRELIMINARY
1. Short title
2. Interpretation
PART II
FORMATION
3. Offer
4. Acceptance
4A. (Deleted)
5. Consideration
\f
Example Agreements
3
LAWS OF MALAYSIA
Act 9999
EXAMPLE AGREEMENTS ACT 2099
An Act to illustrate the layout of an Act.
BE IT ENACTED by the Parliament of an example as follows:
PART I
PRELIMINARY
Short title
1. This Act may be cited as the Example Agreements Act 2099.
Interpretation
2. In this Act, unless the context otherwise requires—
(a) "offer" means a proposal; and
(b) "party" means a person who makes or receives an offer.
PART II
FORMATION
Offer
3. (1) An offer is made when a proposal is communicated
to the other party.
(2) An offer may be revoked before acceptance; see
(4) of section 5 for the effect of revocation.
(2A) An offer made by electronic means is communicated when it
enters the other party's system.
\f
Example Agreements
4
(3) This section applies to offers made after the commencement of this Act.
Acceptance
4. An acceptance must be absolute and unqualified.
4A. (Deleted by Act A9999).
Consideration
5. (1) An agreement without consideration is void, except—
1. as provided in subsection (2); and
2. as provided by any other written law.
(2) A promise made in writing and registered is enforceable.
FIRST SCHEDULE
1. A schedule item that must not become a section.
"""


def _rows(**kw):
    return _ai().build_rows(
        FIXTURE, _my(), law_name="Example Agreements Act 2099", act_no="Act 9999", **kw
    )


def test_sections_skip_cover_arrangement_and_schedule():
    secs = _ai().split_sections(FIXTURE, _my())
    assert [s["num"] for s in secs] == ["1", "2", "3", "4", "4A", "5"]
    assert [s["title"] for s in secs] == [
        "Short title",
        "Interpretation",
        "Offer",
        "Acceptance",
        "",
        "Consideration",
    ]
    assert secs[0]["part"] == "PART I — PRELIMINARY"
    assert secs[2]["part"] == "PART II — FORMATION"
    body5 = secs[5]["body"]
    assert "schedule item" not in body5
    # numbered list inside section 5 stays in its body; no section "1" appears twice
    assert "1. as provided in subsection (2)" in body5


def test_noise_lines_dropped():
    joined = "\n".join(s["body"] for s in _ai().split_sections(FIXTURE, _my()))
    assert "Example Agreements\n" not in joined + "\n"
    assert "LAWS OF MALAYSIA" not in joined
    assert "\n4\n" not in f"\n{joined}\n"


def test_subsections_in_order_and_cross_reference_not_split():
    secs = {s["num"]: s for s in _ai().split_sections(FIXTURE, _my())}
    subs = _ai().split_subsections(secs["3"]["body"], _my())
    assert [label for label, _ in subs] == ["(1)", "(2)", "(2A)", "(3)"]
    # "(4) of section 5" is a wrapped cross-reference, not a new subsection
    assert "(4) of section 5" in subs[1][1]
    assert subs[0][1] == "An offer is made when a proposal is communicated to the other party."
    assert _ai().split_subsections(secs["4"]["body"], _my()) == [
        ("", "An acceptance must be absolute and unqualified.")
    ]


def test_rows_carry_citations_and_pipeline_schema():
    rows = _rows(source_url="https://lom.agc.gov.my/act-detail.php?act=9999", as_at="2100-01-01")
    labels = [r["article_label"] for r in rows]
    assert labels == [
        "Section 1",
        "Section 2",
        "Section 3(1)",
        "Section 3(2)",
        "Section 3(2A)",
        "Section 3(3)",
        "Section 4",
        "Section 4A",
        "Section 5(1)",
        "Section 5(2)",
    ]
    r = rows[2]
    assert r["citation"] == "Example Agreements Act 2099 [Act 9999], s. 3(1)"
    assert r["text"].startswith(
        "Example Agreements Act 2099 [Act 9999], s. 3(1) — Offer: An offer is made"
    )
    assert r["jurisdiction"] == "MY"
    assert r["source_tier"] == "official"
    assert r["authentic"] is False
    assert r["approval_date"] == "2099"
    assert r["as_at"] == "2100-01-01"
    for row in rows:
        assert all(row.get(f) not in (None, "") for f in _ip().REQUIRED_FIELDS if f != "is_active")
        assert _ip().ARTICLE_NO_RE.match(row["article_no"])
    assert rows[7]["article_no"] == "4-a"


def test_repealed_section_flagged_and_blocked_by_pipeline(tmp_path):
    rows = _rows()
    deleted = [r for r in rows if r["section"] == "4A"]
    assert deleted and deleted[0]["status"] == "REPEALED" and deleted[0]["is_active"] is False
    allow = tmp_path / "allow.json"
    allow.write_text(
        json.dumps({"laws": [{"name": "Example Agreements Act 2099", "status": "proposed"}]})
    )
    report = _ip().validate_rows(rows, _ip().load_allowlist(allow, allow_proposed=True))
    # only the deleted section is blocked (no duplicates, bad numbers, missing fields, unlisted)
    assert report["blocked_rows"] == {"repealed": [8]}


def test_unknown_host_is_unofficial():
    assert {r["source_tier"] for r in _rows(source_url="https://mirror.example.org/act.pdf")} == {
        "unofficial"
    }
    assert {r["source_tier"] for r in _rows()} == {"unofficial"}


def test_long_chunks_split_with_unique_labels():
    rows = _rows(max_chars=40)
    parts = [r for r in rows if r["section"] == "2"]
    assert len(parts) > 1
    assert [r["chunk_index"] for r in parts] == list(range(len(parts)))
    assert len({r["article_label"] for r in rows}) == len(rows)
    assert all(len(r["text"].split(": ", 1)[1]) <= 40 for r in parts)


def test_html_input_matches_text():
    html = (
        "<html><head><style>p{}</style><script>var x=1;</script></head><body>"
        + "".join(f"<p>{ln}</p>" for ln in FIXTURE.replace("\f", "").splitlines())
        + "</body></html>"
    )
    from_html = _ai().build_rows(
        _ai().html_to_text(html), _my(), law_name="Example Agreements Act 2099", act_no="Act 9999"
    )
    assert [r["text"] for r in from_html] == [r["text"] for r in _rows()]
    assert "var x" not in _ai().html_to_text(html)


def test_pdf_uses_pdftotext_runner(tmp_path):
    seen = {}

    def runner(cmd, **kw):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout=FIXTURE, stderr="")

    pdf = tmp_path / "a.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    assert _ai().pdf_to_text(pdf, runner=runner) == FIXTURE
    assert seen["cmd"][0] == "pdftotext" and seen["cmd"][-1] == "-"


def test_no_enacting_formula_uses_second_section_one():
    text = FIXTURE.replace("BE IT ENACTED by the Parliament of an example as follows:\n", "")
    secs = _ai().split_sections(text, _my())
    assert [s["num"] for s in secs] == ["1", "2", "3", "4", "4A", "5"]
    assert secs[0]["title"] == "Short title"


def test_cli_dry_run_and_out(tmp_path, capsys):
    src = tmp_path / "act.txt"
    src.write_text(FIXTURE, encoding="utf-8")
    assert (
        _ai().main(["parse", str(src), "--law-name", "Example Agreements Act 2099", "--dry-run"])
        == 0
    )
    report = json.loads(capsys.readouterr().out)
    assert report["rows"] == 10 and report["sections"] == 6 and report["dry_run"] is True
    out = tmp_path / "staged" / "rows.jsonl"
    assert (
        _ai().main(
            ["parse", str(src), "--law-name", "Example Agreements Act 2099", "--out", str(out)]
        )
        == 0
    )
    capsys.readouterr()
    assert len(out.read_text(encoding="utf-8").splitlines()) == 10


def test_pilot_list_has_twenty_proposed_acts():
    laws = _ai().load_pilot()
    assert len(laws) == 20
    names = {law["name"] for law in laws}
    for must in (
        "Contracts Act 1950",
        "Companies Act 2016",
        "Employment Act 1955",
        "Personal Data Protection Act 2010",
    ):
        assert must in names
    assert all(law["status"] == "proposed" for law in laws)
    # proposed entries stay out of the pipeline unless explicitly allowed
    assert _ip().load_allowlist(_ai().MY_ALLOWLIST) == {}
    assert len(_ip().load_allowlist(_ai().MY_ALLOWLIST, allow_proposed=True)) == 20


def test_heading_number_alone_on_its_line():
    text = FIXTURE.replace("4. An acceptance must", "4.\nAn acceptance must")
    secs = {s["num"]: s for s in _ai().split_sections(text, _my())}
    assert secs["4"]["title"] == "Acceptance"
    assert secs["4"]["body"] == "An acceptance must be absolute and unqualified."
