"""Offline tests for domain_expiry and its wiring in synthetic_check (fixture WHOIS answers)."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import domain_expiry as de  # noqa: E402
import synthetic_check as sc  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"
NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


def _answer(name):
    text = (FIX / name).read_text(encoding="utf-8")
    return lambda server, domain: text


def test_parse_irnic_and_verisign():
    irnic = (FIX / "whois_irnic.txt").read_text(encoding="utf-8")
    verisign = (FIX / "whois_verisign.txt").read_text(encoding="utf-8")
    assert de.parse_expiry(irnic) == datetime(2026, 11, 10, tzinfo=timezone.utc)
    assert de.parse_expiry(verisign) == datetime(2027, 5, 1, tzinfo=timezone.utc)
    assert de.parse_expiry("nothing") is None
    assert de.parse_expiry("expire-date:\t2026-13-45\n") is None  # malformed date


def test_malformed_date_is_skipped_not_alerted():
    bad = lambda server, domain: "domain: x.ir\nexpire-date:\t2026-02-30\n"  # noqa: E731
    assert de.check_domain_expiry("x.ir", 30, NOW, bad) is None


def test_levels():
    ok, detail = de.check_domain_expiry("ghazihoushmand.ir", 30, NOW, _answer("whois_irnic.txt"))
    assert ok is False and "(18 days left)" in detail
    ok, _ = de.check_domain_expiry("ghazihoushmand.ir", 14, NOW, _answer("whois_irnic.txt"))
    assert ok is True
    ok, _ = de.check_domain_expiry("roxira.net", 30, NOW, _answer("whois_verisign.txt"))
    assert ok is True
    ok, detail = de.check_domain_expiry("x.ir", 30, NOW, _answer("whois_irnic_missing.txt"))
    assert ok is False and "not registered" in detail


def test_no_answer_or_unknown_tld_is_skipped():
    def refuse(server, domain):
        raise ConnectionRefusedError

    assert de.check_domain_expiry("roxira.ir", 30, NOW, refuse) is None
    assert de.check_domain_expiry("roxira.ir", 30, NOW, lambda s, d: "garbage") is None
    assert de.check_domain_expiry("example.org", 30, NOW, refuse) is None
    assert de.whois_server("roxira.IR") == "whois.nic.ir"


def test_whois_runs_every_few_hours():
    assert sc.whois_due({}, 1_000_000, 6)
    assert not sc.whois_due({"last_whois_ts": 1_000_000 - 3600}, 1_000_000, 6)
    assert sc.whois_due({"last_whois_ts": 1_000_000 - 6 * 3600}, 1_000_000, 6)


def test_run_adds_paths_and_domain_checks(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MONITOR_DOMAINS", "ghazihoushmand.ir,roxira.net")
    monkeypatch.setenv("MONITOR_PATHS", "roxira.ir/app")
    monkeypatch.setattr(sc, "check_site", lambda d: (True, f"200 {d}"))
    monkeypatch.setattr(sc, "check_cert", lambda d, w: (True, "90 days left"))
    monkeypatch.setattr(sc, "check_health", lambda b: (True, "200"))
    monkeypatch.setattr(sc, "chat_due", lambda *a: False)
    verdicts = {"ghazihoushmand.ir": (False, "registration expires soon"), "roxira.net": None}
    monkeypatch.setattr(sc.domain_expiry, "check_domain_expiry", lambda d, w: verdicts[d])
    sent = []
    monkeypatch.setattr(sc.mc, "send_email", lambda s, b, dry_run=False: sent.append(s))

    state = tmp_path / "state.json"
    rc = sc.main(["--state", str(state)])
    out = capsys.readouterr().out
    assert rc == 1
    assert "OK   site:roxira.ir/app: 200 roxira.ir/app" in out
    assert "FAIL domain:ghazihoushmand.ir: registration expires soon" in out
    assert "domain:roxira.net" not in out  # no WHOIS answer: skipped, no alert
    assert sent

    # Within the interval WHOIS is not asked again and the failing state is kept as is.
    verdicts["ghazihoushmand.ir"] = (True, "renewed")
    sc.main(["--state", str(state)])
    assert "domain:" not in capsys.readouterr().out


def test_extra_paths_are_opt_in(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("MONITOR_DOMAINS", "roxira.ir")
    monkeypatch.delenv("MONITOR_PATHS", raising=False)
    monkeypatch.setattr(sc, "check_site", lambda d: (True, f"200 {d}"))
    monkeypatch.setattr(sc, "check_cert", lambda d, w: (True, "90 days left"))
    monkeypatch.setattr(sc, "check_health", lambda b: (True, "200"))
    monkeypatch.setattr(sc, "chat_due", lambda *a: False)
    monkeypatch.setattr(sc, "whois_due", lambda *a: False)
    assert sc.main(["--state", str(tmp_path / "s.json")]) == 0
    out = capsys.readouterr().out
    assert "site:roxira.ir:" in out and "roxira.ir/app" not in out
