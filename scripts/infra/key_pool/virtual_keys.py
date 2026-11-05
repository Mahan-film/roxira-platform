#!/usr/bin/env python3
"""Create the gateway's virtual keys (gateway.virtual_keys in config/key_pool.yaml). Run ON srv1.

  python3 virtual_keys.py                       # create the missing ones, print aliases only
  python3 virtual_keys.py --rotate mac-agents   # delete + recreate one alias (new value)

LiteLLM shows a virtual key's value only once, at creation. New values go to generated/virtual-keys.env
(mode 600, git-ignored) as LLM_GATEWAY_KEY_<ALIAS>=sk-..., and are NEVER printed. Move them to the
clients with an ssh pipe (docs/ops/TWO_COMPUTERS.md), e.g.
  ssh roxira-prod 'grep ^LLM_GATEWAY_KEY_MAC_AGENTS= /opt/roxira_platform/scripts/infra/key_pool/generated/virtual-keys.env'
The master key (KEYPOOL_MASTER_KEY, from generated/keypool.env) authorises the calls; it is never printed.
Budgets: max_budget_usd counts PAID spend per budget_duration; free deployments are priced at 0, so free is unlimited.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

import keypool_config as kc

HERE = pathlib.Path(__file__).resolve().parent
GEN = HERE / "generated"


def env_name(alias: str) -> str:
    return "LLM_GATEWAY_KEY_" + re.sub(r"[^A-Z0-9]+", "_", alias.upper()).strip("_")


def read_env(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def call(base: str, master: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        base.rstrip("/") + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {master}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}
    except OSError:
        return 0, {}


def existing_keys(base: str, master: str, alias: str) -> list[str]:
    """Hashed token ids of keys with this alias (the value itself is unrecoverable)."""
    st, data = call(base, master, "GET", f"/key/list?key_alias={alias}&return_full_object=true&size=100")
    if st != 200:
        return []
    rows = data.get("keys") or []
    return [r["token"] for r in rows if isinstance(r, dict) and r.get("key_alias") == alias and r.get("token")]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:4000")
    ap.add_argument("--rotate", action="append", default=[], help="alias to delete and recreate")
    a = ap.parse_args()
    pool = kc.load_pool()
    specs = pool.get("gateway", {}).get("virtual_keys") or {}
    if not specs:
        print("virtual_keys: nothing configured", file=sys.stderr)
        return 2
    master = os.environ.get("KEYPOOL_MASTER_KEY") or read_env(GEN / "keypool.env").get("KEYPOOL_MASTER_KEY", "")
    if not master:
        print("virtual_keys: KEYPOOL_MASTER_KEY not found (generated/keypool.env)", file=sys.stderr)
        return 2
    out_path = GEN / "virtual-keys.env"
    values = read_env(out_path)
    rc = 0
    for alias, spec in specs.items():
        ids = existing_keys(a.base, master, alias)
        if ids and alias in a.rotate:
            call(a.base, master, "POST", "/key/delete", {"keys": ids})
            ids = []
        if ids:
            print(f"{alias}: exists (value not retrievable; use --rotate {alias} for a new one)")
            continue
        body = {
            "key_alias": alias,
            "models": list(spec["models"]),
            "max_budget": float(spec["max_budget_usd"]),
            "budget_duration": spec.get("budget_duration", "1d"),
            "metadata": {"owner": "roxira", "purpose": "agents via ssh tunnel"},
        }
        st, data = call(a.base, master, "POST", "/key/generate", body)
        if st != 200 or not data.get("key"):
            print(f"{alias}: FAILED (http {st})", file=sys.stderr)
            rc = 1
            continue
        values[env_name(alias)] = data["key"]
        print(f"{alias}: created (budget {spec['max_budget_usd']} USD/{body['budget_duration']} paid, free unlimited)")
    os.umask(0o077)
    out_path.write_text("".join(f"{k}={v}\n" for k, v in sorted(values.items())))
    out_path.chmod(0o600)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
