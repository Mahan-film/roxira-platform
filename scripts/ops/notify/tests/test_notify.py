"""Offline tests for scripts/ops/notify (no network; the HTTP function is injected)."""

from __future__ import annotations

import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve()
DIR = HERE.parents[1]
sys.path.insert(0, str(DIR))

import control_bot  # noqa: E402
import notify  # noqa: E402


class FakeHTTP:
    """Records (url, payload, timeout) and returns a canned dict per method."""

    def __init__(self, responses=None):
        self.calls = []
        self.responses = responses or {}

    def __call__(self, url, payload, timeout=10):
        self.calls.append((url, payload, timeout))
        method = url.rsplit("/", 1)[-1]
        return self.responses.get(method, {"ok": True, "result": {}})

    def methods(self):
        return [url.rsplit("/", 1)[-1] for url, _, _ in self.calls]


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setenv("NOTIFY_ENV_FILE", str(tmp_path / "absent.env"))


def _paths(tmp_path):
    return {
        "freeze": tmp_path / "freeze",
        "autodeploy_last": tmp_path / "autodeploy-last.json",
        "offset": tmp_path / "notify_offset.json",
        "repo": tmp_path,
    }


def _bot(tmp_path, http, runner=None):
    return control_bot.Bot(
        token="token",
        chat_id="555",
        api="https://api.telegram.org",
        http=http,
        paths=_paths(tmp_path),
        runner=runner,
        log=lambda _msg: None,
    )


# ------------------------------------------------------------------ notify.py


def test_missing_token_is_silent_noop(monkeypatch, tmp_path):
    monkeypatch.delenv("NOTIFY_BOT_TOKEN", raising=False)
    monkeypatch.delenv("NOTIFY_CHAT_ID", raising=False)
    _isolate(monkeypatch, tmp_path)
    fake = FakeHTTP()
    assert notify.send("hello", http=fake) is False
    assert fake.calls == []


def test_send_posts_message_with_buttons(monkeypatch, tmp_path):
    monkeypatch.setenv("NOTIFY_BOT_TOKEN", "tok")
    monkeypatch.setenv("NOTIFY_CHAT_ID", "555")
    _isolate(monkeypatch, tmp_path)
    fake = FakeHTTP()
    assert notify.send("hi", buttons=[("✅", "a"), ("❌", "b")], http=fake) is True
    url, payload, _ = fake.calls[0]
    assert url == "https://api.telegram.org/bottok/sendMessage"
    assert payload["chat_id"] == "555"
    assert payload["reply_markup"]["inline_keyboard"] == [
        [{"text": "✅", "callback_data": "a"}, {"text": "❌", "callback_data": "b"}]
    ]


def test_scrub_removes_phone_and_token():
    text = notify.scrub("call 09123456789 token=FakeTokenValue12")
    assert "09123456789" not in text
    assert "FakeTokenValue12" not in text


# ------------------------------------------------------------- command parsing


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("/status", "status"),
        ("/Status", "status"),
        ("/help@MyBot", "help"),
        ("/freeze now", "freeze"),
        ("/unknown", "unknown"),
        ("hello", None),
        ("", None),
        (None, None),
    ],
)
def test_parse_command(text, expected):
    assert control_bot.parse_command(text) == expected


# --------------------------------------------------------------- chat-id gate


def test_chat_id_gate_ignores_other_chats(tmp_path):
    fake = FakeHTTP()
    bot = _bot(tmp_path, fake)
    bot.handle_update({"message": {"chat": {"id": 999}, "text": "/status"}})
    assert fake.calls == []
    assert not (tmp_path / "freeze").exists()


def test_chat_id_gate_accepts_owner(tmp_path):
    fake = FakeHTTP()
    bot = _bot(tmp_path, fake, runner=lambda cmd, timeout=15: (0, "running/healthy"))
    bot.handle_update({"message": {"chat": {"id": 555}, "text": "/help"}})
    assert "sendMessage" in fake.methods()


# -------------------------------------------------------------- callback flow


def test_callback_confirm_freezes(tmp_path):
    fake = FakeHTTP()
    bot = _bot(tmp_path, fake)
    bot.handle_update(
        {
            "callback_query": {
                "id": "cb1",
                "data": "freeze:confirm",
                "message": {"chat": {"id": 555}},
            }
        }
    )
    assert (tmp_path / "freeze").exists()
    assert "sendMessage" in fake.methods()
    assert "answerCallbackQuery" in fake.methods()


def test_callback_confirm_unfreezes(tmp_path):
    (tmp_path / "freeze").write_text("", encoding="utf-8")
    fake = FakeHTTP()
    bot = _bot(tmp_path, fake)
    bot.handle_update(
        {
            "callback_query": {
                "id": "cb2",
                "data": "unfreeze:confirm",
                "message": {"chat": {"id": 555}},
            }
        }
    )
    assert not (tmp_path / "freeze").exists()
    assert "answerCallbackQuery" in fake.methods()


def test_callback_cancel_changes_nothing(tmp_path):
    fake = FakeHTTP()
    bot = _bot(tmp_path, fake)
    bot.handle_update(
        {
            "callback_query": {
                "id": "cb3",
                "data": "freeze:cancel",
                "message": {"chat": {"id": 555}},
            }
        }
    )
    assert not (tmp_path / "freeze").exists()
    assert "answerCallbackQuery" in fake.methods()


def test_callback_from_other_chat_ignored(tmp_path):
    fake = FakeHTTP()
    bot = _bot(tmp_path, fake)
    bot.handle_update(
        {
            "callback_query": {
                "id": "cb4",
                "data": "freeze:confirm",
                "message": {"chat": {"id": 999}},
            }
        }
    )
    assert not (tmp_path / "freeze").exists()
    assert fake.calls == []


# ------------------------------------------------------------------- /status


def test_status_reports_containers_and_freeze(tmp_path):
    (tmp_path / "freeze").write_text("", encoding="utf-8")

    def runner(cmd, timeout=15):
        if cmd[0] == "docker":
            return 0, "running/healthy\n"
        if cmd[0] == "pgrep":
            return 0, "42 bash run_task.sh --slug mytask\n"
        return -1, ""

    fake = FakeHTTP()
    bot = _bot(tmp_path, fake, runner)
    bot.handle_update({"message": {"chat": {"id": 555}, "text": "/status"}})
    text = fake.calls[0][1]["text"]
    assert "roxira_app_prod" in text
    assert "mytask" in text
    assert "🔒" in text


def test_cost_missing_script_reports_unavailable(tmp_path):
    bot = _bot(tmp_path, FakeHTTP())
    assert "در دسترس نیست" in bot.cost_text()


# --------------------------------------------------------------------- install


def test_install_is_dry_run_by_default():
    text = (DIR / "install.sh").read_text(encoding="utf-8")
    assert "--apply" in text
    assert "dry-run" in text
    assert "roxira-control-bot.service" in text