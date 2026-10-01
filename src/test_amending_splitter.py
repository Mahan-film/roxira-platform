import importlib.util
from pathlib import Path


def test_amending_splitter_ignores_quoted_article_headers() -> None:
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "w6_ingest_dotic.py"
    spec = importlib.util.spec_from_file_location("w6", script_path)
    assert spec is not None and spec.loader is not None
    w6 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(w6)

    articles = w6.split_amending_law_by_ordinal(
        "ماده۱ـ الف\nماده۲ـ ب\nماده۲۳ـ نقل شده\nماده۳ـ ج"
    )

    assert [article_no for article_no, _ in articles] == ["1", "2", "3"]
    assert "نقل شده" in articles[1][1]
