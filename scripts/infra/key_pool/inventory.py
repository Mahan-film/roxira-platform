#!/usr/bin/env python3
"""Key inventory: which key slots of each provider in config/key_pool.yaml are set, and do they work.

Usage: inventory.py [--env-file FILE] [--probe] [--provider NAME ...] [--timeout S]
  default    dry run: per provider, every key slot NAME with set/unset, and the 1-token probe it WOULD send.
  --probe    really send that probe: one chat call with max_tokens 1 per set key, on the provider's
             first chat model. Prints ok / 429 / 401 ... per key. Free tiers cost nothing; a paid
             provider costs about one token per key.
  --env-file FILE   read keys from FILE (parsed, never sourced) instead of the environment,
                    $KEYPOOL_ENV_FILE and ~/Secrets/roxira/roxira.env (the llm_pool.py order).
Only variable NAMES are ever printed, never a value. Exit code 1 if a probe failed or a URL setting
(env_vars) is missing for a provider that has keys; 0 otherwise.
"""
from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "dev"))

import keypool_config as kc  # noqa: E402
import llm_pool  # noqa: E402


def probe_model(prov: dict[str, Any]) -> str | None:
    """First chat model id of a provider (embedding models are skipped)."""
    for mid, spec in kc.resolve_model_specs(prov.get("models", [])):
        if spec.get("mode") != "embedding" and not (spec.get("needs_billing") and not prov.get("billing")):
            return mid
    return None


def inventory(pool: dict[str, Any], env: dict[str, str], probe: bool = False, only: list[str] | None = None,
              post: llm_pool.HttpPost = llm_pool.default_post, timeout: float = 20.0,
              out=print) -> int:
    bad = 0
    for pname, prov in pool["providers"].items():
        if only and pname not in only:
            continue
        slots = kc.provider_key_names(prov)
        if not slots:
            continue  # keyless (local TEI)
        set_slots = [k for k in slots if env.get(k)]
        used = kc.provider_keys(prov, set(env))
        missing_vars = [v for v in prov.get("env_vars", []) if not env.get(v)]
        model = probe_model(prov)
        out(f"{pname}  tier={prov['tier']} policy={prov['data_policy']}  keys set {len(set_slots)}/{len(slots)}"
            + (f"  needs {', '.join(missing_vars)}" if missing_vars else ""))
        if missing_vars and set_slots:
            bad += 1
        for k in slots:
            if not env.get(k):
                out(f"  {k:32s} unset")
                continue
            if k not in used:
                out(f"  {k:32s} set   (not used: an earlier keys_any entry wins, or env_vars missing)")
                continue
            url = kc.fill_url(prov["base_url"], env, tuple(prov.get("env_vars", []))).rstrip("/") + "/chat/completions"
            if model is None:
                out(f"  {k:32s} set   (no chat model to probe)")
                continue
            if not probe:
                out(f"  {k:32s} set   would probe {model} at {url.split('/')[2]}")
                continue
            body = {"model": model, "messages": [{"role": "user", "content": "ok"}], "max_tokens": 1,
                    **(prov.get("extra_body") or {})}
            headers = {"Authorization": f"Bearer {env[k]}", "Content-Type": "application/json"}
            status, _ = post(url, headers, body, timeout)
            verdict = "ok" if status == 200 else "no connection" if status == 0 else str(status)
            out(f"  {k:32s} set   {model}: {verdict}")
            bad += status != 200
    if not probe:
        out("(dry run: add --probe to send one 1-token call per set key)")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--provider", action="append")
    ap.add_argument("--timeout", type=float, default=20.0)
    a = ap.parse_args()
    try:
        pool = kc.load_pool()
        env = kc.parse_env_names(a.env_file, kc.all_key_names(pool)) if a.env_file else llm_pool.load_env(pool)
        return inventory(pool, env, a.probe, a.provider, timeout=a.timeout)
    except kc.PoolError as exc:
        print(f"inventory: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
