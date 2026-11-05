#!/usr/bin/env python3
"""Task router for factory scripts: ordered attempts, fallback, cost log, daily caps (issue #288).

    from llm_route import route, review_attempts
    res = route("review_desk", messages, review_attempts(), public=True)
    res.text, res.served, res.attempts

Rules (docs/ops/MODEL_ROUTING.md): free attempts first, then cheap paid, then strong; an attempt that
returns 401/402/403/429/5xx, a timeout, a transport error or an EMPTY answer moves on to the next one.
Paid attempts are refused once the role's or the global daily cap (config/models.yaml `budgets:`) is spent
according to the local cost log. Every call appends one JSON line (task, served attempt, tokens, USD, ms,
error class) to $ROXIRA_LLM_COST_LOG (default ~/.roxira/llm_cost.jsonl). Prompts, answers and keys are
never logged. Keys come from the environment (or ~/Secrets/roxira/roxira.env) and are never printed.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "output_apps" / "generated_modules" / "smartjudge"))
import model_registry  # noqa: E402


class AttemptError(Exception):
    def __init__(self, kind: str):
        super().__init__(kind)
        self.kind = kind


@dataclass
class Attempt:
    name: str                 # e.g. "openrouter/deepseek/deepseek-v4.1-flash"
    role: str                 # models.yaml role used for the cap and the price
    paid: bool
    call: Callable[[list[dict[str, str]], int], tuple[str, int, int]]  # -> (text, tokens_in, tokens_out)
    price_per_1m: tuple[float, float] = (0.0, 0.0)
    public_only: bool = False  # free / may-log provider: public data only


@dataclass
class Result:
    text: str
    served: str
    attempts: list[tuple[str, str]] = field(default_factory=list)
    cost_usd: float = 0.0


class AllAttemptsFailed(RuntimeError):
    def __init__(self, attempts: list[tuple[str, str]]):
        super().__init__("all attempts failed: " + ", ".join(f"{n}={s}" for n, s in attempts))
        self.attempts = attempts


class CapReached(RuntimeError):
    pass


def cost_log_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("ROXIRA_LLM_COST_LOG") or pathlib.Path.home() / ".roxira" / "llm_cost.jsonl")


def spent_today(role: str | None = None, path: pathlib.Path | None = None, now: datetime | None = None) -> float:
    """USD spent today (UTC) according to the local cost log; role=None sums every role."""
    p = path or cost_log_path()
    day = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    total = 0.0
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if str(rec.get("ts", ""))[:10] == day and (role is None or rec.get("role") == role):
                total += float(rec.get("cost_usd") or 0)
    except OSError:
        return 0.0
    return total


def check_caps(att: Attempt, path: pathlib.Path | None = None) -> None:
    if not att.paid:
        return
    cap_g = model_registry.global_daily_cap_usd()
    if cap_g is not None and spent_today(None, path) >= cap_g:
        raise CapReached(f"global daily cap {cap_g} USD reached")
    cap_r = model_registry.role_daily_cap_usd(att.role)
    if cap_r is not None and spent_today(att.role, path) >= cap_r:
        raise CapReached(f"role {att.role} daily cap {cap_r} USD reached")


def _log(rec: dict[str, Any], path: pathlib.Path | None = None) -> None:
    p = path or cost_log_path()
    try:
        p.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
    except OSError:
        pass  # logging must never break a call


def route(task: str, messages: list[dict[str, str]], attempts: list[Attempt], *, max_tokens: int = 1500,
          public: bool = False, log_path: pathlib.Path | None = None) -> Result:
    """Try the attempts in order. public=True declares the payload public (allows public_only attempts)."""
    model_registry.task(task)  # unknown task -> ModelRegistryError
    trail: list[tuple[str, str]] = []
    for att in attempts:
        if att.public_only and not public:
            trail.append((att.name, "skipped:data-policy"))
            continue
        try:
            check_caps(att, log_path)
        except CapReached:
            trail.append((att.name, "skipped:cap"))
            continue
        t0 = time.time()
        try:
            text, tin, tout = att.call(messages, max_tokens)
            if not text.strip():
                raise AttemptError("empty")
        except AttemptError as exc:
            trail.append((att.name, exc.kind))
            _log({"ts": datetime.now(timezone.utc).isoformat(), "task": task, "attempt": att.name, "role": att.role,
                  "ok": False, "error": exc.kind, "ms": int((time.time() - t0) * 1000), "cost_usd": 0}, log_path)
            continue
        cost = (tin * att.price_per_1m[0] + tout * att.price_per_1m[1]) / 1e6 if att.paid else 0.0
        _log({"ts": datetime.now(timezone.utc).isoformat(), "task": task, "attempt": att.name, "role": att.role,
              "ok": True, "tokens_in": tin, "tokens_out": tout, "cost_usd": round(cost, 6),
              "ms": int((time.time() - t0) * 1000), "paid": att.paid}, log_path)
        trail.append((att.name, "ok"))
        return Result(text, att.name, trail, cost)
    if any(st == "skipped:cap" for _, st in trail):
        raise CapReached("daily cap reached; trail: " + ", ".join(f"{n}={st}" for n, st in trail))
    raise AllAttemptsFailed(trail)


# ---- transports -------------------------------------------------------------------------------------

def _classify(code: int | None) -> str:
    return "timeout" if code is None else f"http{code}"


def _parse_openai(body: bytes) -> tuple[str, int, int]:
    d = json.loads(body)
    ch = (d.get("choices") or [{}])[0]
    usage = d.get("usage") or {}
    return (ch.get("message", {}).get("content") or ""), int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


def openai_compat(name: str, base_url: str, key_env: str, model: str, *, role: str, paid: bool,
                  price: tuple[float, float] = (0.0, 0.0), public_only: bool = False,
                  extra: dict[str, Any] | None = None, timeout: float = 90.0,
                  headers: dict[str, str] | None = None) -> Attempt:
    def call(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, int, int]:
        key = os.environ.get(key_env, "")
        if not key:
            raise AttemptError("nokey")
        body = {"model": model, "messages": messages, "max_tokens": max_tokens, **(extra or {})}
        req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", json.dumps(body).encode(),
                                     {**(headers or {}), "Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return _parse_openai(r.read())
        except urllib.error.HTTPError as e:
            raise AttemptError(_classify(e.code)) from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise AttemptError("timeout") from None
    return Attempt(name, role, paid, call, price, public_only)


def gateway_ssh(host: str, group: str, *, role: str, paid: bool, price: tuple[float, float] = (0.0, 0.0),
                public_only: bool = False, timeout: float = 150.0) -> Attempt:
    """Call the key-pool gateway on `host` through ssh; the master key never leaves the server."""
    remote = ("cd /opt/roxira_platform && set -a && . ./.env && set +a && curl -s --max-time 120 "
              "http://127.0.0.1:4000/v1/chat/completions -H \"Authorization: Bearer $KEYPOOL_MASTER_KEY\" "
              "-H 'Content-Type: application/json' -d @-")

    def call(messages: list[dict[str, str]], max_tokens: int) -> tuple[str, int, int]:
        body = json.dumps({"model": group, "messages": messages, "max_tokens": max_tokens}).encode()
        try:
            out = subprocess.run(["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", host, remote],
                                 input=body, capture_output=True, timeout=timeout)
        except (subprocess.TimeoutExpired, OSError):
            raise AttemptError("timeout") from None
        if out.returncode != 0:
            raise AttemptError("ssh")
        try:
            return _parse_openai(out.stdout)
        except ValueError:
            raise AttemptError("badjson") from None
    return Attempt(f"gateway-ssh/{host}/{group}", role, paid, call, price, public_only)


def review_attempts() -> list[Attempt]:
    """Cross-family review chain (never Claude): DeepSeek via OpenRouter, then via the srv1 key pool,
    then DeepSeek's own API, then free non-Claude models (public diffs only). Qwen Coder is excluded
    by owner policy (model_registry.is_forbidden_model_id)."""
    ds = next(e for e in model_registry.role_entries("reviewer") if str(e["id"]).startswith("deepseek/"))["id"]
    gpt_oss = next(e["id"] for e in model_registry.role_entries("agent_runner") if e.get("alias") == "groq-strong")
    price = (0.045, 0.50)
    gw_url = os.environ.get("LLM_GATEWAY_URL") or "http://127.0.0.1:4181/v1"   # ssh tunnel to the srv1 gateway
    out = [
        # srv1 gateway first (stable German IP: Groq/Gemini/OpenRouter work there, the Mac's VPN IP flips). Its agent
        # groups mix free/may-log providers and the agents workspace, so they only ever get public diffs.
        openai_compat("gateway/agent-free-paid", gw_url, "LLM_GATEWAY_KEY", "agent-free-paid", role="reviewer",
                      paid=True, price=price, public_only=True),
        gateway_ssh("roxira-prod", "private", role="reviewer", paid=True, price=price),
        openai_compat("gateway/agent-strong-free", gw_url, "LLM_GATEWAY_KEY", "agent-strong-free", role="reviewer",
                      paid=False, public_only=True),
        # direct providers = last fallback (they break when this machine's VPN exit IP changes)
        openai_compat("openrouter/" + ds, "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", ds, role="reviewer",
                      paid=True, price=price, extra={"reasoning": {"enabled": False}, "provider": {"data_collection": "deny"}}),
        openai_compat("deepseek-api/deepseek-chat", "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY", "deepseek-chat",
                      role="reviewer", paid=True, price=(0.28, 0.42)),
        openai_compat("groq/" + gpt_oss, "https://api.groq.com/openai/v1", "GROQ_API_KEY", gpt_oss,
                      role="reviewer", paid=False, public_only=True),
        openai_compat("mistral/mistral-medium-latest", "https://api.mistral.ai/v1", "MISTRAL_API_KEY",
                      "mistral-medium-latest", role="reviewer", paid=False, public_only=True),
    ]
    return out


def attempts_for(task_name: str, *, extra: dict[str, Any] | None = None, timeout: float = 90.0) -> list[Attempt]:
    """Ordered Attempt list for a task's chain in config/models.yaml (free first).

    Model ids and prices come from the registry, never from a literal here. A step with a
    positive price is paid (so its role cap is enforced); a zero-priced / :free step is
    public_only, so a private payload skips it.
    """
    out: list[Attempt] = []
    for step in model_registry.chain_for(task_name):
        price = step.get("price_per_1m")
        p_in = float((price or {}).get("in") or 0.0)
        p_out = float((price or {}).get("out") or 0.0)
        paid = price is None or p_in > 0.0 or p_out > 0.0
        out.append(openai_compat("openrouter/" + step["id"], "https://openrouter.ai/api/v1",
                                 "OPENROUTER_API_KEY", step["id"], role=step["role"], paid=paid,
                                 price=(p_in, p_out), public_only=not paid, extra=extra, timeout=timeout))
    return out


def selfimprove_attempts() -> list[Attempt]:
    """Chain for the self-improvement loop (task `selfimprove`: free, then cheap_agent)."""
    return attempts_for("selfimprove", extra={"reasoning": {"enabled": False}})


def radar_attempts() -> list[Attempt]:
    """Chain for the tech radar (task `radar`: free, then cheap_agent)."""
    return attempts_for("radar", extra={"reasoning": {"enabled": False}})


def law_watch_attempts() -> list[Attempt]:
    """Chain for law watch's ambiguous-item classifier (task `law_watch`: free, then cheap)."""
    return attempts_for("law_watch", extra={"reasoning": {"enabled": False}})


def auto_review_attempts() -> list[Attempt]:
    """Chain for the health monitor's LLM probe (task `auto_review`: free, then cheap_agent)."""
    return attempts_for("auto_review", extra={"reasoning": {"enabled": False}})


def load_env_file(path: str = "~/Secrets/roxira/roxira.env") -> None:
    """Load NAME=value lines into os.environ (existing values win). Values are never printed."""
    p = pathlib.Path(path).expanduser()
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip().removeprefix("export "), v.strip().strip("'\""))
    except OSError:
        pass


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Cross-family diff review with automatic fallback.")
    ap.add_argument("--diff", help="diff file (default: stdin)")
    ap.add_argument("--prompt", default="Review this diff for correctness bugs, security and data-policy holes and test gaps. Short pass/fail list, max 15 lines, plain text.")
    ap.add_argument("--max-tokens", type=int, default=2500)
    ap.add_argument("--private", action="store_true", help="payload is not public: free / may-log attempts are skipped")
    a = ap.parse_args()
    load_env_file()
    load_env_file("~/Secrets/roxira/llm-gateway.env")
    diff = pathlib.Path(a.diff).read_text(encoding="utf-8") if a.diff else sys.stdin.read()
    try:
        res = route("review_desk", [{"role": "user", "content": a.prompt + "\n" + diff}], review_attempts(),
                    max_tokens=a.max_tokens, public=not a.private)
    except CapReached as exc:
        print("review blocked by cost cap:", exc, file=sys.stderr)
        return 4
    except AllAttemptsFailed as exc:
        print("review failed:", exc, file=sys.stderr)
        return 3
    print(f"[reviewed by {res.served}; trail: {res.attempts}]", file=sys.stderr)
    print(res.text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
