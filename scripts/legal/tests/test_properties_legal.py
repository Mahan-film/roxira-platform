"""Property-based tests (Hypothesis) for the legal data parsers.

Adopted from docs/research/BLUEPRINT_REVIEW_2026-10-15.md. Offline properties only (no network):
  - split_rc_law_articles.split_articles / annotate_amendments
  - ingest_regulations.to_ingest_row
  - iran_relay pure helpers (_iri_to_uri round-trip, _first_date date extraction)
"""
# ruff: noqa: RUF001
import importlib.util
import sys
import urllib.parse
from copy import deepcopy
from pathlib import Path

from hypothesis import given, settings, strategies as st

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

ASCII_DIGITS = "0123456789"
PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
PERSIAN_LETTERS = "ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی"
_DIGITS_TABLE = str.maketrans(ASCII_DIGITS, PERSIAN_DIGITS)
TEXT_ALPHABET = PERSIAN_LETTERS + PERSIAN_DIGITS + ASCII_DIGITS + " .,،؛:"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


srla = _load("split_rc_law_articles", "scripts/legal/split_rc_law_articles.py")
ir = _load("iran_relay", "scripts/legal/iran_relay.py")
regr = _load("ingest_regulations_relay", "scripts/legal/ingest_regulations.py")


def _digits(n: int, persian: bool) -> str:
    return str(n).translate(_DIGITS_TABLE) if persian else str(n)


# body words must never contain the heading marker «ماده», or the parser would split there
BODY_WORDS = (
    "و با از برای این آن که در بر به برابر مطابق حکم نظام کشور مصوب سال هیئت وزیران "
    "موضوع متن زیر شرح نو قدیم می شود است شماره تاریخ تصویب اجرا مقررات قانونی مواد "
    "تبصره بند جزء فصل باب"
).split()


@st.composite
def persian_body(draw):
    n_words = draw(st.integers(min_value=1, max_value=8))
    words = draw(st.lists(st.sampled_from(BODY_WORDS), min_size=n_words, max_size=n_words))
    return " ".join(words) + "."


@st.composite
def law_text(draw):
    n = draw(st.integers(min_value=1, max_value=60))
    articles, bodies = [], []
    for i in range(1, n + 1):
        num = _digits(i, draw(st.booleans()))
        mok = " مکرر" if draw(st.booleans()) else ""
        sep = draw(st.sampled_from(["-", ":", "—", "."]))
        body = draw(persian_body())
        bodies.append(body)
        articles.append(f"ماده {num}{mok} {sep} {body}")
    return "".join(articles), n, bodies


@st.composite
def amendment_batch(draw):
    base_name = draw(st.sampled_from(["قانون نظام صنفی کشور", "قانون تجارت", "قانون کار"]))
    tail = base_name[len("قانون "):] if base_name.startswith("قانون ") else base_name
    n_base = draw(st.integers(min_value=1, max_value=6))
    base_rows = [
        {"law_name": base_name, "article_no": str(i), "text": f"ماده {i} {base_name}: متن اصلی"}
        for i in range(1, n_base + 1)
    ]
    targets = draw(st.lists(
        st.sampled_from([str(i) for i in range(1, n_base + 1)]),
        min_size=1, max_size=min(3, n_base), unique=True,
    ))
    amending_name = "قانون اصلاح " + base_name
    item_rows = []
    for j, tgt in enumerate(targets, start=1):
        ref = _digits(int(tgt), draw(st.booleans()))
        item_rows.append({
            "law_name": amending_name,
            "article_no": str(j),
            "approval_date": "1392/06/12",
            "text": (
                f"ماده {j} {amending_name}: ماده ({ref}) "
                f"قانون {tail} به شرح زیر اصلاح می شود: نو"
            ),
        })
    unrelated = [
        {"law_name": "قانون نمونه دیگر", "article_no": str(i), "text": f"ماده {i}: متن"}
        for i in (1, 2)
    ]
    return base_rows + item_rows + unrelated, base_name


@st.composite
def relay_row(draw):
    source = draw(st.sampled_from(["taxreg", "dotic", "rcmajlis"]))
    return {
        "source": source,
        "doc_id": f"{source}:{draw(st.integers(min_value=1, max_value=10**9))}",
        "doc_type": draw(st.sampled_from(["circular", "bylaw", "law", "other"])),
        "title": draw(st.text(alphabet=PERSIAN_LETTERS + " ", min_size=1, max_size=40)),
        "number": draw(st.one_of(
            st.none(),
            st.text(alphabet=ASCII_DIGITS + "/-", min_size=1, max_size=20),
        )),
        "date": draw(st.one_of(
            st.none(),
            st.text(alphabet=ASCII_DIGITS + "/", min_size=8, max_size=10),
        )),
        "issuer": draw(st.one_of(
            st.none(),
            st.text(alphabet=PERSIAN_LETTERS + " ", min_size=1, max_size=20),
        )),
        "text": draw(st.text(alphabet=TEXT_ALPHABET, min_size=1, max_size=400)),
        "url": f"https://example.ir/{source}/doc",
        "fetched_at": "2026-10-14T00:00:00Z",
        "staging_status": "proposed",
        "needs_review": True,
        "source_tier": "official",
        "chunk_index": 0,
    }


@st.composite
def dated_text(draw):
    y = draw(st.integers(min_value=1300, max_value=1405))
    m = draw(st.integers(min_value=1, max_value=12))
    d = draw(st.integers(min_value=1, max_value=29))
    date = f"{y}/{m}/{d}"
    if draw(st.booleans()):
        date = date.translate(_DIGITS_TABLE)
    pre = draw(st.text(alphabet=PERSIAN_LETTERS + " ", min_size=0, max_size=30))
    post = draw(st.text(alphabet=PERSIAN_LETTERS + " ", min_size=0, max_size=30))
    return f"{pre} {date} {post}", date


@settings(max_examples=200, deadline=None)
@given(law_text())
def test_split_articles_properties(law):
    text, n, bodies = law
    arts = srla.split_articles(text)
    assert len(arts) == n
    assert [int(a["no"].split("-")[0]) for a in arts] == list(range(1, n + 1))
    assert [a["body"] for a in arts] == bodies
    assert all(a["body"] for a in arts)


@settings(max_examples=200, deadline=None)
@given(amendment_batch())
def test_annotate_amendments_properties(batch):
    rows, base_name = batch
    before = [(r["article_no"], r["law_name"]) for r in rows]
    srla.annotate_amendments(rows)
    assert [(r["article_no"], r["law_name"]) for r in rows] == before
    for r in rows:
        if "amended_by" in r:
            assert r["law_name"] == base_name
    snapshot = deepcopy(rows)
    assert srla.annotate_amendments(rows) == 0
    assert rows == snapshot


@settings(max_examples=200, deadline=None)
@given(relay_row())
def test_to_ingest_row_properties(row):
    out = regr.to_ingest_row(row)
    assert out["law_name"] in regr.RELAY_LAWS.values()
    assert out["law_type"] == "REGULATION"
    assert out["full_text"] == row["text"]


@settings(max_examples=200, deadline=None)
@given(st.text(
    alphabet=PERSIAN_LETTERS + PERSIAN_DIGITS + ASCII_DIGITS + "-_",
    min_size=1, max_size=40,
))
def test_iri_to_uri_round_trip(slug):
    url = f"https://dotic.ir/news/21635/{slug}"
    out = ir._iri_to_uri(url)
    assert out.isascii()
    assert urllib.parse.unquote(out) == url


@settings(max_examples=200, deadline=None)
@given(dated_text())
def test_first_date_round_trip(dated):
    text, date = dated
    assert ir._first_date(text) == date
