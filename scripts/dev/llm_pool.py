#!/usr/bin/env python3
"""Free-first LLM client over config/key_pool.yaml. Works with or without the gateway.

  llm_pool.py -p "prompt" [-g agent-free] [--max-tokens 512] [--direct | --gateway URL]
  echo "prompt" | llm_pool.py -g agent-free
  llm_pool.py --health [--direct | --gateway URL]      ok/429/fail per provider or group
  llm_pool.py --list [-g GROUP]                        deployments in order (names only)

Mode: if AGENT_GATEWAY_URL (or --gateway) is set the gateway group is tried first, then direct calls
in key_pool.yaml order. Direct mode rotates on 429/5xx/timeouts/auth errors and puts a failing
provider in a short cooldown (state file under $TMPDIR) so a blocked one (OpenRouter from Iran
without VPN) costs one quick TCP check, not a timeout, on later calls.
Keys: environment, then $KEYPOOL_ENV_FILE, then ~/Secrets/roxira/roxira.env (parsed, only names from
key_pool.yaml). Keys are never printed. Group `private` is checked for may_log/free providers.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import random
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "infra" / "key_pool"))

import keypool_config as kc

COOLDOWN = {429: 60, 5: 30, "conn": 300, "auth": 3600}  # seconds; 5 = any 5xx

PROXY_ENV_VARS = ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")

HttpPost = Callable[[str, dict[str, str], dict[str, Any], float], "tuple[int, dict[str, Any] | None]"]


def proxy_configured() -> bool:
    """True when urllib would route through a proxy, so a raw socket check would be wrong."""
    return any(os.environ.get(name) for name in PROXY_ENV_VARS)


def default_post(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float) -> tuple[int, dict[str, Any] | None]:
    """Return (status, json). status 0 = no connection / timeout."""
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if not proxy_configured():
        try:  # quick reachability check so a blocked host fails in seconds
            socket.create_connection((host, port), timeout=min(5.0, timeout)).close()
        except OSError:
            return 0, None
    # Some providers sit behind Cloudflare, which rejects the default Python-urllib agent (error 1010).
    headers = {"User-Agent": "roxira-keypool/1.0", **headers}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, None
    except (OSError, ValueError):
        return 0, None


def load_env(pool: dict[str, Any]) -> dict[str, str]:
    wanted = kc.all_key_names(pool)
    env = {n: os.environ[n] for n in wanted if os.environ.get(n)}
    for f in (os.environ.get("KEYPOOL_ENV_FILE"), "~/Secrets/roxira/roxira.env"):
        if f:
            for n, v in kc.parse_env_names(f, wanted).items():
                env.setdefault(n, v)
    return env


class State:
    def __init__(self, path: str | None):
        self.path = path
        self.until: dict[str, float] = {}
        if path and os.path.isfile(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    self.until = {k: float(v) for k, v in json.load(fh).items()}
            except (OSError, ValueError):
                self.until = {}

    def hot(self, key: str, now: float) -> bool:
        return self.until.get(key, 0) > now

    def cool(self, key: str, seconds: float, now: float) -> None:
        self.until[key] = now + seconds
        if self.path:
            try:
                with open(self.path, "w", encoding="utf-8") as fh:
                    json.dump({k: v for k, v in self.until.items() if v > now}, fh)
            except OSError:
                pass


def default_state_path() -> str:
    return os.path.join(os.environ.get("TMPDIR") or tempfile.gettempdir(), "llm_pool_state.json")


def ordered(deps: list[kc.Deployment], rng: random.Random) -> list[kc.Deployment]:
    """Keep rank order; within a rank, a weighted shuffle of every key of every provider (weight = per-key limit)."""
    out: list[kc.Deployment] = []
    for o in sorted({d.order for d in deps}):
        tier = [d for d in deps if d.order == o]
        # Efraimidis-Spirakis: sort by u^(1/w), so a key with twice the weight comes first twice as often
        tier.sort(key=lambda d: rng.random() ** (1.0 / max(1, d.weight)), reverse=True)
        out.extend(tier)
    return out


def dedupe_keys(deps: list[kc.Deployment], env: dict[str, str]) -> list[kc.Deployment]:
    """Drop a deployment whose key VALUE equals an earlier slot of the same provider and model (two env slots
    holding one key would share one rate limit, so the second is only a wasted retry). Values are never logged."""
    seen: set[tuple[str, str, str]] = set()
    out: list[kc.Deployment] = []
    for d in deps:
        sig = (d.provider, d.model, env.get(d.key_env, d.key_env))
        if sig in seen:
            continue
        seen.add(sig)
        out.append(d)
    return out


def _cool_kind(status: int) -> int | str:
    if status == 0:
        return "conn"
    if status in (401, 403):
        return "auth"
    if status == 429:
        return 429
    return 5


def chat(
    messages: list[dict[str, str]],
    group: str = "agent-free",
    max_tokens: int = 512,
    *,
    pool: dict[str, Any] | None = None,
    env: dict[str, str] | None = None,
    post: HttpPost = default_post,
    state: State | None = None,
    timeout: float = 45.0,
    rng: random.Random | None = None,
    now: Callable[[], float] = time.time,
    log: Callable[[str], None] | None = None,
    skip: Callable[[kc.Deployment], bool] | None = None,
) -> tuple[str, str]:
    """Direct provider rotation. Returns (text, 'provider/model'). Raises RuntimeError when all fail."""
    pool = pool or kc.load_pool()
    env = env if env is not None else load_env(pool)
    state = state or State(None)
    log = log or (lambda m: None)
    deps = ordered(kc.group_deployments(pool, group, set(env)), rng or random.Random())
    deps = dedupe_keys(deps, env)
    if skip:  # e.g. the reviewer must not be the author's model family
        deps = [d for d in deps if not skip(d)]
    if not deps:
        raise RuntimeError(f"group {group}: no usable provider (no keys found for it)")
    tried: list[str] = []
    for d in deps:
        ck = f"{d.provider}|{d.key_env}"
        if state.hot(ck, now()):
            tried.append(f"{d.provider}:cooldown")
            continue
        body: dict[str, Any] = {"model": d.model, "messages": messages, "max_tokens": max_tokens}
        body.update(d.extra_body)
        headers = {"Authorization": f"Bearer {env[d.key_env]}", "Content-Type": "application/json"}
        status, data = post(kc.fill_url(d.base_url, env, d.url_vars).rstrip("/") + "/chat/completions", headers, body, timeout)
        if status == 200 and data:
            try:
                return data["choices"][0]["message"]["content"] or "", f"{d.provider}/{d.model}"
            except (KeyError, IndexError, TypeError):
                status = 502
        tried.append(f"{d.provider}:{status or 'conn'}")
        state.cool(ck, COOLDOWN[_cool_kind(status)], now())
        log(f"{d.provider}/{d.model} -> {status or 'no connection'}, rotating")
    raise RuntimeError("all providers failed: " + ", ".join(tried))


def via_gateway(url: str, key: str, messages: list[dict[str, str]], group: str, max_tokens: int,
                post: HttpPost = default_post, timeout: float = 60.0) -> str | None:
    status, data = post(url.rstrip("/") + "/chat/completions",
                        {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                        {"model": group, "messages": messages, "max_tokens": max_tokens}, timeout)
    if status == 200 and data:
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            return None
    return None


def health(pool: dict[str, Any], env: dict[str, str], gateway: str | None, post: HttpPost = default_post) -> int:
    ping = [{"role": "user", "content": "Reply with: ok"}]
    bad = 0
    if gateway:
        key = env.get(pool["gateway"]["master_key_env"], "")
        for g in pool["groups"]:
            st, _ = post(gateway.rstrip("/") + "/chat/completions", {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                         {"model": g, "messages": ping, "max_tokens": 5}, 45.0)
            print(f"group {g:12s} {'ok' if st == 200 else '429' if st == 429 else 'fail'}")
            bad += st != 200
        return 1 if bad else 0
    seen: set[str] = set()
    for g in pool["groups"]:
        for d in kc.group_deployments(pool, g, set(env)):
            ck = f"{d.provider}|{d.key_env}|{d.model}"
            if ck in seen:
                continue
            seen.add(ck)
            st, _ = post(kc.fill_url(d.base_url, env, d.url_vars).rstrip("/") + "/chat/completions",
                         {"Authorization": f"Bearer {env[d.key_env]}", "Content-Type": "application/json"},
                         {"model": d.model, "messages": ping, "max_tokens": 5, **d.extra_body}, 30.0)
            print(f"{d.provider:16s} {d.key_env:26s} {d.model:34s} {'ok' if st == 200 else st or 'conn'}")
            bad += st != 200
    missing = [p for p, prov in pool["providers"].items() if kc.provider_key_names(prov) and not kc.provider_keys(prov, set(env))]
    for p in missing:
        print(f"{p:16s} (no key set)")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-p", "--prompt")
    ap.add_argument("-g", "--group", default="agent-free")
    ap.add_argument("--max-tokens", type=int, default=512)
    ap.add_argument("--direct", action="store_true", help="skip the gateway")
    ap.add_argument("--gateway", default=os.environ.get("AGENT_GATEWAY_URL"))
    ap.add_argument("--health", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--timeout", type=float, default=45.0)
    a = ap.parse_args()
    try:
        pool = kc.load_pool()
        env = load_env(pool)
        gw = None if a.direct else a.gateway
        if a.list:
            for d in kc.group_deployments(pool, a.group, set(env) or None):
                print(f"{d.order} {d.provider} {d.key_env} {d.model} tier={d.tier} policy={d.data_policy}")
            return 0
        if a.health:
            return health(pool, env, gw)
        prompt = a.prompt if a.prompt is not None else sys.stdin.read()
        if not prompt.strip():
            print("llm_pool: empty prompt", file=sys.stderr)
            return 2
        msgs = [{"role": "user", "content": prompt}]
        if gw:
            text = via_gateway(gw, env.get(pool["gateway"]["master_key_env"], ""), msgs, a.group, a.max_tokens)
            if text is not None:
                print(text)
                return 0
            print("llm_pool: gateway failed, trying providers directly", file=sys.stderr)
        text, used = chat(msgs, a.group, a.max_tokens, pool=pool, env=env, state=State(default_state_path()),
                          timeout=a.timeout, log=lambda m: print(f"llm_pool: {m}", file=sys.stderr))
        print(f"llm_pool: answered by {used}", file=sys.stderr)
        print(text)
        return 0
    except (kc.PoolError, RuntimeError) as exc:
        print(f"llm_pool: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
