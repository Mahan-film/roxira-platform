#!/usr/bin/env python3
"""Prove the key pool: one real call per provider, then a forced 429 on one key.

  pool_proof.py                 one call per provider (first usable deployment), prints provider, key NAME, status
  pool_proof.py --failover groq force a 429 on the first key of that provider and show who answers instead

Output has provider ids, env var NAMES, models and HTTP status codes only. Key values are never printed:
a key is mapped back to its env var name inside this process.
"""
from __future__ import annotations

import argparse
import random
import sys

import llm_pool as lp
import keypool_config as kc


def recording_post(env: dict[str, str], force_429_for: bool | str | None, trail: list[str]):
    by_value = {v: k for k, v in env.items() if v}
    forced = {"done": False}

    def post(url, headers, body, timeout):
        name = by_value.get(headers.get("Authorization", "").removeprefix("Bearer "), "?")
        if force_429_for and not forced["done"]:  # the first deployment the pool tries, whichever key it is
            forced["done"] = True
            trail.append(f"{name} {body['model']} -> 429 (forced)")
            return 429, None
        status, data = lp.default_post(url, headers, body, timeout)
        trail.append(f"{name} {body['model']} -> {status or 'conn'}")
        return status, data
    return post


def one_per_provider(pool, env) -> int:
    bad = 0
    ping = [{"role": "user", "content": "Reply with: ok"}]
    for pname, prov in pool["providers"].items():
        if not kc.provider_keys(prov, set(env)) or any(m.get("mode") == "embedding" for m in prov.get("models", [])):
            print(f"{pname:16s} no key set / not a chat provider")
            continue
        group = next((g for g, spec in pool["groups"].items() if pname in (spec.get("providers") or [])), None)
        trail: list[str] = []
        try:
            text, used = lp.chat(ping, group, 8, pool=pool, env=env, post=recording_post(env, None, trail),
                                 skip=lambda d, p=pname: d.provider != p, rng=random.Random(1), timeout=40.0)
            print(f"{pname:16s} served {used:48s} via {trail[-1].split()[0]}  ok")
        except RuntimeError as exc:
            bad += 1
            print(f"{pname:16s} FAILED {str(exc)[:90]}")
    return bad


def failover(pool, env, provider: str, group: str) -> int:
    first = kc.provider_keys(pool["providers"][provider], set(env))
    names = [k for k in first]
    trail: list[str] = []
    ping = [{"role": "user", "content": "Reply with: ok"}]
    # keep only deployments of this provider's first model so "the next key" is visible
    deps = kc.group_deployments(pool, group, set(env))
    model = next(d.model for d in deps if d.provider == provider)
    text, used = lp.chat(ping, group, 8, pool=pool, env=env, post=recording_post(env, True, trail),
                         skip=lambda d: not (d.provider == provider and d.model == model), rng=random.Random(2), timeout=40.0)
    print("\n".join(trail))
    print(f"served by {used}; the key that got the forced 429 is in cooldown, the next deployment answered")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--failover", metavar="PROVIDER")
    ap.add_argument("--group", default="agent-strong-free")
    a = ap.parse_args()
    pool = kc.load_pool()
    env = lp.load_env(pool)
    return failover(pool, env, a.failover, a.group) if a.failover else (1 if one_per_provider(pool, env) else 0)


if __name__ == "__main__":
    sys.exit(main())
