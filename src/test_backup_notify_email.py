"""notify_email.py strips the display spaces of a Gmail App Password before login."""

from __future__ import annotations

import importlib.util
import smtplib
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ops" / "backup" / "notify_email.py"


def _load():
    spec = importlib.util.spec_from_file_location("notify_email_under_test", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_normalize_password_strips_all_whitespace() -> None:
    mod = _load()
    assert mod.normalize_password("abcd efgh ijkl mnop") == "abcdefghijklmnop"
    assert mod.normalize_password(" abcd\tefgh\nijkl  mnop ") == "abcdefghijklmnop"
    assert len(mod.normalize_password("abcd efgh ijkl mnop")) == 16


def test_login_uses_stripped_password_and_auth_error_gives_hint(tmp_path, monkeypatch, capsys) -> None:
    mod = _load()
    seen = {}

    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self, **k): pass
        def login(self, user, pw):
            seen["pw"] = pw
            raise smtplib.SMTPAuthenticationError(535, b"bad")
        def send_message(self, m): raise AssertionError("must not send")

    body = tmp_path / "b.txt"
    body.write_text("hi")
    monkeypatch.setattr(mod.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("BACKUP_SMTP_USER", "u@example.invalid")
    monkeypatch.setenv("BACKUP_SMTP_PASS", "abcd efgh ijkl mnop")
    monkeypatch.setenv("BACKUP_NOTIFY_TO", "t@example.invalid")
    monkeypatch.setattr(sys, "argv", ["x", "--subject", "s", "--body-file", str(body)])
    assert mod.main() == 4
    assert seen["pw"] == "abcdefghijklmnop"
    assert "App Password" in capsys.readouterr().err
