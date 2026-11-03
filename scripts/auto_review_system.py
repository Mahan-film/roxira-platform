#!/usr/bin/env python3
"""
ROXIRA AUTONOMOUS PLATFORM HEALTH MONITOR & SELF-HEALING
پایش خودکار سلامت پلتفرم و ترمیم خودکار سرویس‌ها

بررسی‌ها:
  ۱) دیتابیس‌ها: SQLite (auth) / PostgreSQL / Redis / Qdrant
  ۲) LLM: تأخیر endpoint و اعتبار JSON خروجی
  ۳) جریان احراز هویت: سلامت مسیرها و وضعیت پیکربندی OTP (بدون ارسال پیامک واقعی مگر با فلگ)

Self-Healing:
  - اگر /health اپ پاسخ ندهد، در صورت فعال بودن AUTO_REVIEW_ALLOW_RESTART=1
    کانتینر roxira_app_prod با docker restart بازراه‌اندازی می‌شود.

لاگ: /opt/roxira_platform/data/system_health.log

اجرا: python3 scripts/auto_review_system.py [--once | --loop [interval_sec]]
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = pathlib.Path("/opt/roxira_platform")
DATA = BASE / "data"
LOG_PATH = DATA / "system_health.log"
LOG_MAX_BYTES = 5 * 1024 * 1024
LOG_KEEP = 3

ALLOW_RESTART = os.getenv("AUTO_REVIEW_ALLOW_RESTART", "0") == "1"
ALLOW_OTP_DISPATCH = os.getenv("AUTO_REVIEW_OTP_DISPATCH", "0") == "1"

APP_URL = os.getenv("AUTO_REVIEW_APP_URL", "http://127.0.0.1")  # روی هاست از طریق nginx؛ داخل کانتینر قابل override به :8000
# nginx routes by Host; a catch-all that answers 444 to unknown Host values would drop a bare-IP
# request, so every app call sends the public host explicitly.
APP_HOST_HEADER = os.getenv("AUTO_REVIEW_HOST_HEADER", "roxira.ir")
PG_HOST = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT = os.getenv("POSTGRES_PORT", "5432")
PG_USER = os.getenv("POSTGRES_USER", "enterprise_admin")
PG_DB = os.getenv("POSTGRES_DB", "enterprise_db")
QDRANT_HOST = os.getenv("QDRANT_HOST", "127.0.0.1")
QDRANT_PORT = os.getenv("QDRANT_PORT", "6333")


def log(level: str, msg: str) -> None:
    """لاگ ساختارمند با چرخش خودکار فایل."""
    DATA.mkdir(parents=True, exist_ok=True)
    try:
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > LOG_MAX_BYTES:
            for i in range(LOG_KEEP - 1, 0, -1):
                older = pathlib.Path(str(LOG_PATH) + f".{i}")
                newer = pathlib.Path(str(LOG_PATH) + f".{i - 1}") if i > 1 else LOG_PATH
                if newer.exists():
                    older.write_bytes(newer.read_bytes())
            LOG_PATH.write_bytes(b"")
    except Exception:
        pass
    line = f"{datetime.now(timezone.utc).isoformat()} [{level}] {msg}"
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line)


def _app_host_headers(url: str) -> dict:
    """Host header only for calls to our own app (never to external APIs such as openrouter.ai)."""
    if APP_HOST_HEADER and url.startswith(APP_URL + "/"):
        return {"Host": APP_HOST_HEADER}
    return {}


def http_get(url: str, timeout: float = 8.0):
    req = urllib.request.Request(url, headers={"Accept": "application/json", **_app_host_headers(url)})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "ignore")
            return r.status, body, (time.monotonic() - t0) * 1000.0
    except urllib.error.HTTPError as e:  # 4xx/5xx هم «پاسخ» است، نه استثنا
        try:
            body = e.read().decode("utf-8", "ignore")
        except Exception:
            body = ""
        return e.code, body, (time.monotonic() - t0) * 1000.0
    except Exception as exc:
        return None, str(exc), (time.monotonic() - t0) * 1000.0


def http_post_json(url: str, payload: dict, timeout: float = 60.0, headers: dict = None):
    all_headers = {"Content-Type": "application/json", "Accept": "application/json", **_app_host_headers(url)}
    if headers:
        all_headers.update(headers)
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=all_headers,
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "ignore")
            return r.status, body, (time.monotonic() - t0) * 1000.0
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "ignore")
        except Exception:
            body = ""
        return e.code, body, (time.monotonic() - t0) * 1000.0
    except Exception as exc:
        return None, str(exc), (time.monotonic() - t0) * 1000.0


# ─────────────────────────── بررسی‌های دیتابیس ───────────────────────────
def check_sqlite() -> dict:
    try:
        path = DATA / "users.db"
        if not path.exists():
            return {"ok": False, "detail": "users.db یافت نشد"}
        conn = sqlite3.connect(str(path), timeout=5)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        conn.close()
        return {"ok": integrity == "ok", "detail": f"integrity={integrity} users={users}"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


def _pg_query(sql: str):
    cmd = ["docker", "exec", "roxira_postgres_prod", "psql", "-U", PG_USER, "-d", PG_DB, "-t", "-A", "-c", sql]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200] or "psql failed")
    return r.stdout.strip()


def check_postgres() -> dict:
    try:
        version = _pg_query("SELECT version();").split(",")[0]
        graph_nodes = _pg_query("SELECT COUNT(*) FROM graph_nodes;")
        graph_edges = _pg_query("SELECT COUNT(*) FROM graph_edges;")
        return {"ok": True, "detail": f"{version} | graph_nodes={graph_nodes} graph_edges={graph_edges}"}
    except FileNotFoundError:
        try:  # اجرا داخل کانتینر — اتصال مستقیم psycopg
            import psycopg  # type: ignore
            conn_str = (f"postgresql://{PG_USER}:{os.environ['POSTGRES_PASSWORD']}"
                        f"@{os.getenv('POSTGRES_HOST', 'postgres_prod')}:{PG_PORT}/{PG_DB}")
            with psycopg.connect(conn_str, connect_timeout=5) as c:
                with c.cursor() as cur:
                    cur.execute("SELECT COUNT(*) FROM graph_nodes")
                    n = cur.fetchone()[0]
            return {"ok": True, "detail": f"direct psycopg | graph_nodes={n}"}
        except Exception as exc:
            return {"ok": False, "detail": str(exc)[:200]}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


def check_redis() -> dict:
    try:
        r = subprocess.run(["docker", "exec", "roxira_redis_prod", "redis-cli", "ping"],
                           capture_output=True, text=True, timeout=10)
        if r.returncode == 0 and "PONG" in r.stdout:
            return {"ok": True, "detail": "PONG"}
        return {"ok": False, "detail": (r.stdout.strip() or r.stderr.strip())[:100]}
    except FileNotFoundError:
        return {"ok": True, "detail": "docker-cli absent (in-container) — skipped"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


def check_qdrant() -> dict:
    status, body, ms = http_get(f"http://{QDRANT_HOST}:{QDRANT_PORT}/collections", timeout=6)
    if status != 200:
        return {"ok": False, "detail": f"HTTP {status}: {body[:150]}"}
    try:
        cols = json.loads(body).get("result", {}).get("collections", [])
        names = [c.get("name") for c in cols]
        return {"ok": True, "detail": f"{len(cols)} collections: {', '.join(names[:6])} ({ms:.0f}ms)"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}
# ─────────────────────────── بررسی LLM ───────────────────────────
def _openrouter_key() -> str:
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    env_p = BASE / ".env"
    if env_p.exists():
        for line in env_p.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("OPENROUTER_API_KEY="):
                return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def check_llm() -> dict:
    key = _openrouter_key()
    if not key:
        return {"ok": False, "detail": "OPENROUTER_API_KEY تنظیم نشده"}
    payload = {
        "model": "deepseek/deepseek-chat",
        "messages": [{"role": "user", "content": "فقط کلمه OK را برگردان."}],
        "max_tokens": 20,
        "temperature": 0,
    }
    status, body, ms = http_post_json(
        "https://openrouter.ai/api/v1/chat/completions", payload, timeout=60,
        headers={"Authorization": f"Bearer {key}", "HTTP-Referer": "https://ghazihoushmand.ir"},
    )
    if status != 200:
        return {"ok": False, "detail": f"HTTP {status} ({ms:.0f}ms): {body[:150]}"}
    try:
        msg = json.loads(body)["choices"][0]["message"]
        content = (msg.get("content") or "").strip() or str(msg.get("reasoning") or "").strip()
        return {"ok": bool(content), "detail": f"{ms:.0f}ms | content={content[:40]!r}"}
    except Exception as exc:
        return {"ok": False, "detail": f"bad body ({ms:.0f}ms): {str(exc)[:120]}"}


def check_llm_json_pipeline() -> dict:
    """اعتبار JSON خروجی خط لوله کامل analyze-case."""
    payload = {"case_text": "ادعای مطالبه وجه چک صیادی", "engine_tier": "tier1"}
    status, body, ms = http_post_json(f"{APP_URL}/api/v1/apps/judge/analyze-case", payload, timeout=150)
    if status != 200:
        return {"ok": False, "detail": f"HTTP {status} ({ms:.0f}ms): {body[:150]}"}
    try:
        d = json.loads(body)
        ok = d.get("status") == "SUCCESS" and bool(d.get("legal_advisory")) and isinstance(d.get("matched_laws"), list)
        return {"ok": ok, "detail": f"{ms:.0f}ms | tier={d.get('tier')} model={d.get('model_used')} laws={len(d.get('matched_laws', []))}"}
    except Exception as exc:
        return {"ok": False, "detail": f"invalid JSON ({ms:.0f}ms): {str(exc)[:120]}"}


# ─────────────────────────── بررسی Auth / OTP ───────────────────────────
def check_auth() -> dict:
    s1, b1, _ = http_post_json(f"{APP_URL}/api/v1/auth/login",
                               {"identifier": "__health_probe__", "password": "wrong"}, timeout=20)
    s2, b2, _ = http_post_json(f"{APP_URL}/api/v1/auth/verify-otp",
                               {"phone_number": "09111111111", "code": "000000"}, timeout=20)
    ok = s1 == 401 and s2 == 400
    detail = f"login:{s1}(expect 401) | verify-otp:{s2}(expect 400)"
    if not ok:
        detail += f" | errors: {b1[:80]} / {b2[:80]}"
    return {"ok": ok, "detail": detail}


def check_otp_config() -> dict:
    key = ""
    env_p = BASE / ".env"
    if env_p.exists():
        for line in env_p.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("KAVENEGAR_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("'\"")
                break
    if not key:
        return {"ok": False, "detail": "KAVENEGAR_API_KEY تنظیم نشده"}
    if ALLOW_OTP_DISPATCH:
        status, body, ms = http_post_json(
            f"{APP_URL}/api/v1/auth/request-otp",
            {"phone_number": os.getenv("AUTO_REVIEW_OTP_PHONE", ""), "target_service": "roxira"},
            timeout=30,
        )
        return {"ok": status == 200, "detail": f"dispatch HTTP {status} ({ms:.0f}ms): {body[:120]}"}
    return {"ok": True, "detail": f"Kavenegar key configured (len={len(key)}) — dispatch disabled (set AUTO_REVIEW_OTP_DISPATCH=1)"}


# ─────────────────────────── Self-Healing ───────────────────────────
def attempt_self_heal() -> None:
    if not ALLOW_RESTART:
        log("HEAL", "restart disabled (set AUTO_REVIEW_ALLOW_RESTART=1)")
        return
    log("HEAL", "attempting docker restart roxira_app_prod ...")
    try:
        r = subprocess.run(["docker", "restart", "roxira_app_prod"], capture_output=True, text=True, timeout=120)
        log("HEAL", f"restart rc={r.returncode} {(r.stdout.strip() + r.stderr.strip())[:100]}")
    except Exception as exc:
        log("HEAL-ERR", str(exc)[:200])
def run_full_review() -> bool:
    log("REVIEW", "================ full review start ================")
    all_ok = True

    app_status, _, app_ms = http_get(f"{APP_URL}/health", timeout=10)
    log("APP", f"/health HTTP {app_status} ({app_ms:.0f}ms)")
    if app_status != 200:
        all_ok = False
        attempt_self_heal()
        time.sleep(8)
        app_status, _, app_ms = http_get(f"{APP_URL}/health", timeout=10)
        log("APP", f"post-heal /health HTTP {app_status} ({app_ms:.0f}ms)")
        if app_status == 200:
            all_ok = True

    checks = {
        "SQLITE": check_sqlite,
        "POSTGRES": check_postgres,
        "REDIS": check_redis,
        "QDRANT": check_qdrant,
        "LLM": check_llm,
        "LLM_PIPELINE": check_llm_json_pipeline,
        "AUTH": check_auth,
        "OTP": check_otp_config,
    }
    for name, fn in checks.items():
        try:
            res = fn()
        except Exception as exc:
            res = {"ok": False, "detail": f"unhandled: {exc}"[:200]}
        state = "OK " if res.get("ok") else "FAIL"
        if not res.get("ok"):
            all_ok = False
        log(name, f"[{state}] {res.get('detail', '')}")

    log("REVIEW", f"================ full review end | overall={'HEALTHY' if all_ok else 'DEGRADED'} ================")
    return all_ok


def main() -> None:
    args = sys.argv[1:]
    log("BOOT", f"auto_review_system starting | allow_restart={ALLOW_RESTART} otp_dispatch={ALLOW_OTP_DISPATCH}")
    if "--loop" in args:
        idx = args.index("--loop")
        interval = int(args[idx + 1]) if len(args) > idx + 1 and args[idx + 1].isdigit() else 300
        log("BOOT", f"loop mode — every {interval}s")
        while True:
            try:
                run_full_review()
            except Exception as exc:
                log("ERR", f"review crashed: {exc}"[:200])
            time.sleep(interval)
    else:
        ok = run_full_review()
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()