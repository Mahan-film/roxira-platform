"""Unit tests for the pure parsing/normalisation functions in
``scripts/w6_ingest_dotic.py`` (W6 — DOTIC article-level ingest).

Pure functions only: no pandas/pyarrow, no network, no Qdrant, no
sentence_transformers. Those live behind lazy imports in the script itself
and are exercised locally (see docs/W6_legal_corpus_diagnosis.md), not here.
"""
from __future__ import annotations

import sys
from pathlib import Path

from scripts.w6_ingest_dotic import (
    build_point_id,
    content_hash,
    dedupe_articles,
    derive_article_no,
    detect_status,
    extract_amended_on,
    find_missing_numbers,
    main,
    normalize_text,
    split_long_text,
    split_owner_text_by_articles,
)


class TestNormalizeText:
    def test_arabic_letter_variants_are_converted(self) -> None:
        assert normalize_text("كتاب ي") == "کتاب ی"

    def test_page_markers_are_stripped(self) -> None:
        assert "©" not in normalize_text("متن©13© ادامه©190©")
        assert normalize_text("قبل©13©بعد") == "قبلبعد"

    def test_control_characters_are_stripped(self) -> None:
        assert normalize_text("متن(\x02)بعد") == "متن()بعد"

    def test_whitespace_is_collapsed(self) -> None:
        assert normalize_text("سلام    دنیا") == "سلام دنیا"
        assert normalize_text("سلام\r\nدنیا") == "سلام\nدنیا"
        assert normalize_text("پاراگراف اول\n\n\n\nپاراگراف دوم") == "پاراگراف اول\n\nپاراگراف دوم"

    def test_does_not_reconstruct_zwnj(self) -> None:
        # We deliberately never insert a half-space (ZWNJ) that was not there.
        assert "‌" not in normalize_text("میشود رییسجمهور")

    def test_empty_input(self) -> None:
        assert normalize_text("") == ""
        assert normalize_text(None) == ""  # type: ignore[arg-type]


class TestExtractAmendedOn:
    def test_parses_latin_digit_date(self) -> None:
        assert extract_amended_on("ماده 1 (اصلاحي 14/8/1370) ـ متن") == "1370-08-14"

    def test_parses_normalised_yeh(self) -> None:
        assert extract_amended_on("ماده 2 (اصلاحی 29/8/1348) ـ متن") == "1348-08-29"

    def test_returns_none_without_amendment_note(self) -> None:
        assert extract_amended_on("ماده 3 ـ انتشار قوانین باید در روزنامه رسمی به عمل آید.") is None

    def test_does_not_match_elhaghi_only(self) -> None:
        # Spec only asks to parse "اصلاحي", not "الحاقي" (a different kind of note).
        assert extract_amended_on("ماده 218 مكرر (الحاقي 14/8/1370) ـ متن") is None


class TestDetectStatus:
    def test_repealed_phrasing(self) -> None:
        text = "ماده 1309ـ به موجب نظریه ... خلاف موازین شرع اعلام و ابطال شده است."
        assert detect_status(text) == "REPEALED"

    def test_valid_by_default(self) -> None:
        assert detect_status("ماده 3 ـ انتشار قوانین باید در روزنامه رسمی به عمل آید.") == "VALID"


class TestDeriveArticleNo:
    def test_plain_article(self) -> None:
        assert derive_article_no("ماده 3", "ماده 3 ـ متن") == "3"

    def test_mokarrar_suffix_from_body_header(self) -> None:
        body = "ماده 218 مكرر (الحاقي 14/8/1370) ـ متن"
        assert derive_article_no("ماده 218", body) == "218-mokarrar"

    def test_normalised_mokarrar_spelling(self) -> None:
        assert derive_article_no("ماده 881", "ماده 881 مکرر ـ متن") == "881-mokarrar"

    def test_persian_digits_in_raw_number(self) -> None:
        assert derive_article_no("ماده ۱۰", "ماده 10 ـ متن") == "10"


class TestSplitLongText:
    def test_short_text_is_single_chunk(self) -> None:
        assert split_long_text("یک متن کوتاه", max_len=1500) == ["یک متن کوتاه"]

    def test_long_text_is_split_on_paragraph_breaks(self) -> None:
        para_a = "الف " * 200  # ~1000 chars
        para_b = "ب " * 200
        text = f"{para_a}\n\n{para_b}"
        chunks = split_long_text(text, max_len=1200)
        assert len(chunks) >= 2
        joined = "".join(chunks).replace("\n", "").replace(" ", "")
        original = text.replace("\n", "").replace(" ", "")
        assert joined == original

    def test_never_drops_text_even_when_one_paragraph_exceeds_max_len(self) -> None:
        sentence = "این یک جمله بلند است. " * 100
        chunks = split_long_text(sentence, max_len=200)
        assert len(chunks) > 1
        assert sum(len(c) for c in chunks) > 0
        # No chunk is silently empty.
        assert all(c.strip() for c in chunks)

    def test_empty_text(self) -> None:
        assert split_long_text("") == [""]


class TestDedupeArticles:
    def test_unique_rows_pass_through(self) -> None:
        rows = [
            {"law_id": "L", "article_no": "1", "text": "متن یک"},
            {"law_id": "L", "article_no": "2", "text": "متن دو"},
        ]
        kept, dropped = dedupe_articles(rows)
        assert kept == rows
        assert dropped == []

    def test_duplicate_keeps_longer_text(self) -> None:
        rows = [
            {"law_id": "L", "article_no": "1", "text": "کوتاه"},
            {"law_id": "L", "article_no": "1", "text": "این متن طولانی‌تر است"},
        ]
        kept, dropped = dedupe_articles(rows)
        assert len(kept) == 1
        assert kept[0]["text"] == "این متن طولانی‌تر است"
        assert len(dropped) == 1
        assert dropped[0]["text"] == "کوتاه"

    def test_tie_keeps_later_occurrence(self) -> None:
        rows = [
            {"law_id": "L", "article_no": "1", "text": "abcde"},
            {"law_id": "L", "article_no": "1", "text": "fghij"},
        ]
        kept, _dropped = dedupe_articles(rows)
        assert kept[0]["text"] == "fghij"


class TestFindMissingNumbers:
    def test_reports_gaps_in_range(self) -> None:
        nos = [str(n) for n in range(1, 10) if n not in (5, 6)]
        assert find_missing_numbers(nos) == [5, 6]

    def test_ignores_mokarrar_suffix_for_range(self) -> None:
        nos = ["1", "2", "2-mokarrar", "3"]
        assert find_missing_numbers(nos) == []

    def test_empty_input(self) -> None:
        assert find_missing_numbers([]) == []


class TestSplitOwnerTextByArticles:
    def test_splits_on_article_headings(self) -> None:
        text = "ماده 1- متن اول\nادامه متن اول\n\nماده 2- متن دوم"
        pairs = split_owner_text_by_articles(text)
        assert [p[0] for p in pairs] == ["1", "2"]
        assert "متن اول" in pairs[0][1]
        assert "متن دوم" in pairs[1][1]

    def test_mokarrar_heading(self) -> None:
        text = "ماده 3- متن\n\nماده 3 مکرر- متن مکرر"
        pairs = split_owner_text_by_articles(text)
        assert [p[0] for p in pairs] == ["3", "3-mokarrar"]

    def test_no_headings_returns_empty(self) -> None:
        assert split_owner_text_by_articles("این یک متن بدون ماده است.") == []


class TestContentHashAndPointId:
    def test_content_hash_is_stable(self) -> None:
        assert content_hash("متن ثابت") == content_hash("متن ثابت")

    def test_content_hash_differs_for_different_text(self) -> None:
        assert content_hash("متن الف") != content_hash("متن ب")

    def test_point_id_is_deterministic(self) -> None:
        a = build_point_id("ir-5580", "1", 0)
        b = build_point_id("ir-5580", "1", 0)
        assert a == b

    def test_point_id_differs_by_chunk_index(self) -> None:
        a = build_point_id("ir-5580", "1", 0)
        b = build_point_id("ir-5580", "1", 1)
        assert a != b


class TestDryRunNeverWritesBuild:
    """``--dry-run`` must parse and print only; it must never touch ``--build``.

    Uses an owner-supplied ``.txt`` so no pandas/pyarrow/Qdrant/network is
    needed (see the script's lazy-import design note).
    """

    def _run(self, monkeypatch, argv: list[str]) -> int:
        monkeypatch.setattr(sys, "argv", ["w6_ingest_dotic.py", *argv])
        return main()

    def test_dry_run_does_not_create_build_file(self, tmp_path, monkeypatch) -> None:
        src = tmp_path / "law.txt"
        src.write_text("ماده 1- متن اول\n\nماده 2- متن دوم", encoding="utf-8")
        out = tmp_path / "out.jsonl"
        rc = self._run(
            monkeypatch,
            [
                "--file", str(src),
                "--law-name", "قانون آزمایشی",
                "--law-type", "CIVIL",
                "--build", str(out),
                "--dry-run",
            ],
        )
        assert rc == 0
        assert not out.exists()

    def test_dry_run_does_not_append_to_existing_build_file(self, tmp_path, monkeypatch) -> None:
        src = tmp_path / "law.txt"
        src.write_text("ماده 1- متن اول", encoding="utf-8")
        out = tmp_path / "out.jsonl"
        out.write_text('{"existing": true}\n', encoding="utf-8")
        rc = self._run(
            monkeypatch,
            [
                "--file", str(src),
                "--law-name", "قانون آزمایشی",
                "--law-type", "CIVIL",
                "--build", str(out),
                "--append",
                "--dry-run",
            ],
        )
        assert rc == 0
        assert out.read_text(encoding="utf-8") == '{"existing": true}\n'

    def test_build_still_writes_without_dry_run(self, tmp_path, monkeypatch) -> None:
        src = tmp_path / "law.txt"
        src.write_text("ماده 1- متن اول", encoding="utf-8")
        out = tmp_path / "out.jsonl"
        rc = self._run(
            monkeypatch,
            [
                "--file", str(src),
                "--law-name", "قانون آزمایشی",
                "--law-type", "CIVIL",
                "--build", str(out),
            ],
        )
        assert rc == 0
        assert out.read_text(encoding="utf-8").strip()
