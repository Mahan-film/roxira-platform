"""Digest queue: queueing, FAIL/RECOVERED collapsing, urgent rule + cooldown, render, send (no network)."""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import notify  # noqa: E402

T0 = 1_800_000_000.0


class FakeHTTP:
    def __init__(self):
        self.calls = []

    def __call__(self, url, payload, timeout=10):
        self.calls.append(payload["text"])
        return {"ok": True}


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("NOTIFY_BOT_TOKEN", "tok")
    monkeypatch.setenv("NOTIFY_CHAT_ID", "1")
    monkeypatch.setenv("NOTIFY_ENV_FILE", str(tmp_path / "none.env"))
    return str(tmp_path / "q.db"), FakeHTTP()


def _events(db):
    con = notify._db(db)
    rows = con.execute("SELECT id,ts,source,key,kind,severity,text,down_s,path FROM events ORDER BY id").fetchall()
    opens = con.execute("SELECT key,source,since,detail FROM open_failures").fetchall()
    con.close()
    return rows, opens


def test_alerts_are_queued_not_sent_and_still_failing_is_muted(env):
    db, http = env
    notify.enqueue_alerts([("FAIL", "chat_p95", "p95 41s")], "self-improvement", now=T0, db=db, http=http)
    for i in range(1, 6):  # five STILL FAILING repeats
        notify.enqueue_alerts([("STILL FAILING", "chat_p95", f"p95 4{i}s")], "self-improvement",
                              now=T0 + i * 7200, db=db, http=http)
    rows, opens = _events(db)
    assert [r[4] for r in rows] == ["FAIL"]          # repeats create no events
    assert opens[0][3] == "p95 45s"                  # but the open failure keeps the latest detail
    assert http.calls == []                          # nothing urgent, nothing sent


def test_flapping_check_collapses_to_one_line(env):
    db, http = env
    for i in range(3):
        t = T0 + i * 600
        notify.enqueue_alerts([("FAIL", "judge-health", "status=502")], "synthetic", now=t, db=db, http=http)
        notify.enqueue_alerts([("RECOVERED", "judge-health", "200 (down 4 min)")], "synthetic",
                              now=t + 240, db=db, http=http)
    rows, opens = _events(db)
    subject, body, counts = notify.render_digest(rows, opens, now=T0 + 7200)
    lines = [ln for ln in body.splitlines() if "judge-health" in ln]
    assert len(lines) == 1
    assert "failed 3x, recovered 3x" in lines[0] and "12 min" in lines[0]
    assert counts["flapping"] == 1 and counts["open"] == 0


def test_open_failure_listed_once_with_duration(env):
    db, http = env
    notify.enqueue_alerts([("FAIL", "tls:roxira.net", "9 days left")], "synthetic", now=T0, db=db, http=http)
    rows, opens = _events(db)
    _, body, _ = notify.render_digest(rows, opens, now=T0 + 3 * 3600)
    assert body.count("STILL FAILING tls:roxira.net") == 1 and "3 h 0 min" in body


def test_site_down_over_15_min_is_urgent_telegram_only_with_cooldown(env):
    db, http = env
    notify.enqueue_alerts([("FAIL", "site:roxira.ir", "502")], "synthetic", now=T0, db=db, http=http)
    assert notify.enqueue_alerts([], "synthetic", now=T0 + 600, db=db, http=http) == 0     # 10 min: not yet
    assert http.calls == []
    assert notify.enqueue_alerts([], "synthetic", now=T0 + 20 * 60, db=db, http=http) == 1  # 20 min: urgent
    assert len(http.calls) == 1 and "site:roxira.ir" in http.calls[0]
    for i in range(1, 12):                                                                   # every 5 min for an hour
        notify.enqueue_alerts([], "synthetic", now=T0 + 20 * 60 + i * 300, db=db, http=http)
    assert len(http.calls) == 1                                                              # cooldown: still one
    notify.enqueue_alerts([], "synthetic", now=T0 + 20 * 60 + 3601, db=db, http=http)
    assert len(http.calls) == 2                                                              # next hour: one more


def test_non_site_failure_is_never_urgent(env):
    db, http = env
    notify.enqueue_alerts([("FAIL", "tls:roxira.net", "5 days left")], "synthetic", now=T0, db=db, http=http)
    notify.enqueue_alerts([], "synthetic", now=T0 + 5 * 3600, db=db, http=http)
    assert http.calls == []


def test_urgent_cooldown_is_per_key_and_recorded_once(env):
    db, http = env
    assert notify.urgent("backup:FAILED", "pg_dump failed", now=T0, db=db, http=http)
    assert not notify.urgent("backup:FAILED", "pg_dump failed", now=T0 + 600, db=db, http=http)
    assert notify.urgent("disk-full", "92%", now=T0 + 700, db=db, http=http)
    rows, _ = _events(db)
    assert [r[3] for r in rows] == ["backup:FAILED", "disk-full"]
    assert len(http.calls) == 2


def test_digest_sends_one_mail_groups_and_clears_queue(env):
    db, http = env
    notify.urgent("deploy-failed", "abc1234 rolled back", now=T0, db=db, http=http)
    notify.enqueue_alerts([("FAIL", "judge-health", "502"), ("FAIL", "chat_p95", "slow")], "synthetic",
                          now=T0 + 60, db=db, http=http)
    notify.enqueue_report("selfimprove", "Smart Judge daily improvement report 2026-11-04",
                          "line one\nline two\n" + "x" * 500, path="/var/lib/r/2026-11-04.md", now=T0 + 90, db=db)
    mails = []
    res = notify.send_digest(now=T0 + 3600, db=db, mailer=lambda s, b: mails.append((s, b)) or True, http=http)
    assert res == "sent" and len(mails) == 1
    subject, body = mails[0]
    assert subject.startswith("[Roxira digest]") and "1 urgent" in subject
    assert body.index("== URGENT") < body.index("== ALERTS") < body.index("== REPORTS")
    assert "file: /var/lib/r/2026-11-04.md" in body
    assert max(len(ln) for ln in body.splitlines()) < 260   # reports are short summaries
    rows, opens = _events(db)
    assert rows == [] and len(opens) == 2                    # events cleared, open failures kept for next time


def test_digest_failure_keeps_queue_and_empty_sends_nothing(env):
    db, http = env
    assert notify.send_digest(now=T0, db=db, mailer=lambda s, b: True, http=http) == "empty"
    notify.enqueue_report("radar", "Tech radar weekly", "3 adopt", now=T0, db=db)
    assert notify.send_digest(now=T0 + 10, db=db, mailer=lambda s, b: False, http=http) == "failed"
    assert len(_events(db)[0]) == 1


def test_digest_never_twice_within_six_hours(env):
    db, http = env
    notify.enqueue_report("radar", "a", "x", now=T0, db=db)
    assert notify.send_digest(now=T0, db=db, mailer=lambda s, b: True, http=http) == "sent"
    notify.enqueue_report("radar", "b", "y", now=T0 + 60, db=db)
    assert notify.send_digest(now=T0 + 3600, db=db, mailer=lambda s, b: True, http=http) == "too-soon"
    assert notify.send_digest(now=T0 + 7 * 3600, db=db, mailer=lambda s, b: True, http=http) == "sent"


def test_secrets_are_scrubbed_on_enqueue(env):
    db, _ = env
    notify.enqueue("x", "k", "REPORT", "mail a@b.com token=abc123 Bearer abcdef", "INFO", db=db)
    text = _events(db)[0][0][6]
    assert "a@b.com" not in text and "abc123" not in text and "abcdef" not in text


def test_smtp_send_without_credentials_is_false(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("NOTIFY_MAIL_ENV_FILE", str(tmp_path / "none"))
    for n in ("BACKUP_SMTP_USER", "BACKUP_SMTP_PASS", "BACKUP_NOTIFY_TO"):
        monkeypatch.delenv(n, raising=False)
    assert notify.smtp_send("s", "b") is False
