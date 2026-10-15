#!/usr/bin/env python3
"""Owner control bot for the Roxira production host (Telegram or Bale).

Telegram and Bale share the same bot API, so this one script serves both. It long-polls
getUpdates and answers a tiny, fixed command set in Persian. It only ever reacts to the
single owner chat (NOTIFY_CHAT_ID); every other chat is ignored with a one-line warning.
It never runs shell text taken from a message and never echoes environment values.

Commands: /status  /freeze  /unfreeze  /cost  /help

Env (read from the server .env): NOTIFY_BOT_TOKEN, NOTIFY_CHAT_ID, NOTIFY_BOT_API.
Optional overrides: NOTIFY_STATE_DIR, NOTIFY_REPO_DIR, DEPLOY_FREEZE_FILE.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notify  # noqa: E402

CONTAINERS = (
    "roxira_app_prod",
    "roxira_enterprise_backend",
    "roxira_enterprise_frontend",
    "roxira_keypool",
)
DOCKER_HEALTH_FORMAT = "{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}"
_SLUG = re.compile(r"--slug\s+(\S+)")
_SHA7 = 7
COST_LIMIT = 3500

HELP = (
    "دستورهای ربات:\n"
    "/status — وضعیت استقرار، داکر و ایجنت‌ها\n"
    "/freeze — توقف استقرار خودکار\n"
    "/unfreeze — فعال‌کردن استقرار خودکار\n"
    "/cost — گزارش هزینه امروز\n"
    "/help — همین راهنما"
)


def parse_command(text: str):
    """Return the lowercased command name (/status@Bot -> 'status'), or None."""
    if not text:
        return None
    text = text.strip()
    if not text.startswith("/"):
        return None
    token = text.split()[0].split("@", 1)[0]
    name = token[1:].lower()
    return name or None


def _as_chat_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def default_paths() -> dict:
    state = os.environ.get("NOTIFY_STATE_DIR", "/root/deploy-state")
    return {
        "freeze": os.environ.get("DEPLOY_FREEZE_FILE", "/opt/roxira_platform/.deploy-freeze"),
        "autodeploy_last": os.path.join(state, "autodeploy-last.json"),
        "offset": os.path.join(state, "notify_offset.json"),
        "repo": os.environ.get("NOTIFY_REPO_DIR", "/opt/roxira_platform"),
    }


def _run(cmd, timeout: float = 15):
    """Run a fixed command (never message text). Returns (returncode, stdout)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False
        )
        return result.returncode, result.stdout or ""
    except (OSError, subprocess.SubprocessError):
        return -1, ""


def load_offset(path) -> int:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return int(data.get("offset", 0))
    except (OSError, ValueError, AttributeError):
        return 0


def save_offset(path, offset: int) -> None:
    try:
        os.makedirs(os.path.dirname(str(path)) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"offset": int(offset)}, fh)
    except OSError:
        pass


class Bot:
    def __init__(self, *, token, chat_id, api, http, paths=None, runner=None, log=None):
        self.token = token
        self.chat_id = _as_chat_id(chat_id)
        self.api = (api or notify.DEFAULT_API).rstrip("/")
        self.http = http
        self.paths = paths or default_paths()
        self.runner = runner or _run
        self.log = log or (lambda msg: print(msg, file=sys.stderr))

    # ---------------------------------------------------------------- transport
    def api_call(self, method: str, payload: dict, timeout: float = 10) -> dict:
        return self.http(f"{self.api}/bot{self.token}/{method}", payload, timeout)

    def send(self, text: str, buttons=None) -> None:
        payload = {
            "chat_id": self.chat_id,
            "text": text[:notify.MAX_MESSAGE],
            "disable_web_page_preview": True,
        }
        if buttons:
            payload["reply_markup"] = {
                "inline_keyboard": [
                    [{"text": label, "callback_data": data} for label, data in buttons]
                ]
            }
        try:
            self.api_call("sendMessage", payload)
        except Exception:
            self.log("sendMessage failed")

    def answer_callback(self, callback_id: str, text: str = "") -> None:
        try:
            self.api_call(
                "answerCallbackQuery", {"callback_query_id": callback_id, "text": text}
            )
        except Exception:
            self.log("answerCallbackQuery failed")

    # ------------------------------------------------------------------- gating
    def _allowed(self, chat_id) -> bool:
        if _as_chat_id(chat_id) == self.chat_id:
            return True
        self.log(f"ignored update from chat {chat_id!r} (not the owner chat)")
        return False

    # ----------------------------------------------------------------- dispatch
    def handle_update(self, update: dict) -> None:
        callback = update.get("callback_query")
        if callback:
            message = callback.get("message") or {}
            if not self._allowed((message.get("chat") or {}).get("id")):
                return
            self._on_callback(callback)
            return
        message = update.get("message")
        if message:
            if not self._allowed((message.get("chat") or {}).get("id")):
                return
            self._on_message(message)

    def _on_message(self, message: dict) -> None:
        command = parse_command(message.get("text") or "")
        if command == "status":
            self.send(self.status_text())
        elif command == "freeze":
            self.send(
                "استقرار خودکار متوقف شود؟",
                [("✅ تأیید", "freeze:confirm"), ("❌ لغو", "freeze:cancel")],
            )
        elif command == "unfreeze":
            self.send(
                "استقرار خودکار فعال شود؟",
                [("✅ تأیید", "unfreeze:confirm"), ("❌ لغو", "unfreeze:cancel")],
            )
        elif command == "cost":
            self.send(self.cost_text())
        elif command in ("help", "start"):
            self.send(HELP)

    def _on_callback(self, callback: dict) -> None:
        data = callback.get("data") or ""
        cb_id = callback.get("id", "")
        if data == "freeze:confirm":
            self._touch(self.paths["freeze"])
            self.answer_callback(cb_id, "تأیید شد")
            self.send("🔒 استقرار خودکار متوقف شد.")
        elif data == "freeze:cancel":
            self.answer_callback(cb_id, "لغو شد")
            self.send("لغو شد؛ تغییری اعمال نشد.")
        elif data == "unfreeze:confirm":
            self._remove(self.paths["freeze"])
            self.answer_callback(cb_id, "تأیید شد")
            self.send("🔓 استقرار خودکار فعال شد.")
        elif data == "unfreeze:cancel":
            self.answer_callback(cb_id, "لغو شد")
            self.send("لغو شد؛ تغییری اعمال نشد.")

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _touch(path) -> None:
        try:
            os.makedirs(os.path.dirname(str(path)) or ".", exist_ok=True)
            with open(path, "a", encoding="utf-8"):
                pass
        except OSError:
            pass

    @staticmethod
    def _remove(path) -> None:
        try:
            os.remove(str(path))
        except OSError:
            pass

    def _read_last_deploy(self) -> dict:
        try:
            with open(self.paths["autodeploy_last"], encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def status_text(self) -> str:
        lines = ["📊 وضعیت سیستم:"]
        last = self._read_last_deploy()
        if last:
            target = str(last.get("target", ""))[:_SHA7]
            lines.append(
                "آخرین استقرار: "
                f"{last.get('time', '?')} | {target or '?'} | {last.get('result', '?')}"
            )
        else:
            lines.append("آخرین استقرار: نامشخص")
        for container in CONTAINERS:
            rc, out = self.runner(["docker", "inspect", "-f", DOCKER_HEALTH_FORMAT, container])
            health = out.strip() if rc == 0 and out.strip() else "پیدا نشد"
            lines.append(f"داکر {container}: {health}")
        lines.append("ایجنت‌های فعال: " + (", ".join(self._agent_slugs()) or "ندارد"))
        frozen = os.path.exists(str(self.paths["freeze"]))
        lines.append("استقرار خودکار: " + ("🔒 متوقف" if frozen else "🔓 فعال"))
        return "\n".join(lines)

    def _agent_slugs(self) -> list:
        rc, out = self.runner(["pgrep", "-fa", "run_task.sh"])
        if rc != 0:
            return []
        slugs = []
        for line in out.splitlines():
            match = _SLUG.search(line)
            if match and match.group(1) not in slugs:
                slugs.append(match.group(1))
        return slugs

    def cost_text(self) -> str:
        script = os.path.join(
            self.paths["repo"], "scripts", "infra", "key_pool", "cost_report.py"
        )
        if not os.path.isfile(script):
            return "گزارش هزینه در دسترس نیست."
        rc, out = self.runner([sys.executable, script, "--today", "--short"], timeout=30)
        out = (out or "").strip()
        return out[:COST_LIMIT] if out else "گزارش هزینه خالی است."


def run_forever(bot: Bot, *, sleep=time.sleep) -> None:
    """Long-poll getUpdates (timeout 50) and dispatch; the offset is persisted."""
    offset = load_offset(bot.paths["offset"])
    while True:
        try:
            data = bot.api_call(
                "getUpdates",
                {
                    "offset": offset,
                    "timeout": 50,
                    "allowed_updates": ["message", "callback_query"],
                },
                timeout=60,
            )
        except Exception as exc:
            bot.log(f"getUpdates failed: {type(exc).__name__}")
            sleep(5)
            continue
        if not isinstance(data, dict) or not data.get("ok"):
            sleep(5)
            continue
        updates = data.get("result") or []
        for update in updates:
            try:
                bot.handle_update(update)
            except Exception as exc:
                bot.log(f"update handler failed: {type(exc).__name__}")
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                offset = update_id + 1
        if updates:
            save_offset(bot.paths["offset"], offset)


def main() -> int:
    cfg = notify.settings()
    if not cfg["token"] or not cfg["chat_id"]:
        print("control bot off: NOTIFY_BOT_TOKEN / NOTIFY_CHAT_ID not set", file=sys.stderr)
        return 0
    bot = Bot(token=cfg["token"], chat_id=cfg["chat_id"], api=cfg["api"], http=notify.http_post)
    run_forever(bot)
    return 0


if __name__ == "__main__":
    sys.exit(main())