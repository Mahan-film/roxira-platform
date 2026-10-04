"""Offline tests for scripts/dev/stt_bakeoff.py (script loaded inside a fixture)."""
# ruff: noqa: RUF001

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def sb():
    spec = importlib.util.spec_from_file_location(
        "stt_bakeoff", ROOT / "scripts" / "dev" / "stt_bakeoff.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_normalise_unifies_letters_and_digits(sb):
    assert sb.normalize_fa("كتاب علي") == sb.normalize_fa("کتاب علی")
    assert sb.normalize_fa("ماده ۱۰") == "ماده 10"
    assert sb.normalize_fa("می‌خواهم،") == "می خواهم"
    assert sb.normalize_fa("سَلام!") == "سلام"


def test_wer_basic(sb):
    assert sb.wer("a b c d", "a b c d") == 0
    assert sb.wer("a b c d", "a x c") == pytest.approx(0.5)
    assert sb.wer("", "") == 0
    assert sb.wer("سلام دنیا", "سلام ي دنیا") == pytest.approx(0.5)
    assert sb.wer("ماده ۱۰", "ماده 10.") == 0


def test_cost_estimator(sb):
    prices = {"x": {"usd_per_hour": 0.36}}
    assert sb.estimate_cost("x", 3600, prices) == pytest.approx(0.36)
    assert sb.estimate_cost("x", None, prices) is None
    assert sb.estimate_cost("missing", 60, prices) is None


def test_price_file_valid(sb):
    p = sb.load_prices()
    assert p["assemblyai:universal-2"]["usd_per_hour"] == 0.15
    assert all("verified" in v and v["usd_per_hour"] >= 0 for v in p.values())
    json.dumps(p)


def test_scrub_hides_keys(sb):
    assert "sekret" not in sb.scrub("bad Bearer sekret here", ["sekret"])


def test_large_file_refused(sb, tmp_path):
    f = tmp_path / "big.wav"
    with open(f, "wb") as fh:
        fh.truncate(sb.MAX_BYTES + 1)
    with pytest.raises(SystemExit):
        sb.check_audio(f)


def test_no_key_leak_without_providers(sb, tmp_path, monkeypatch, capsys):
    a, r = tmp_path / "a.wav", tmp_path / "r.txt"
    a.write_bytes(b"x")
    r.write_text("سلام", encoding="utf-8")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("ASSEMBLYAI_API_KEYS", "")
    monkeypatch.setattr(sb.shutil, "which", lambda _n: None)
    assert sb.main(["--audio", str(a), "--ref", str(r)]) == 1


def test_make_sample(sb, capsys):
    assert sb.main(["--make-sample"]) == 0
    assert len(capsys.readouterr().out.strip().splitlines()) >= 8
