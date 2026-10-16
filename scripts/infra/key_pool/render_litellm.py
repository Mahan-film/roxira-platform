#!/usr/bin/env python3
"""Render the LiteLLM proxy config from config/key_pool.yaml (the single source).

Usage: render_litellm.py [--pool FILE] [--env-file FILE] [--out FILE|-]
  --env-file FILE  only deployments whose key env var is set (non-empty) in FILE are rendered;
                   FILE is parsed, never sourced, and no value is ever printed or written.
                   Without it every provider is rendered (offline check / tests).
Keys appear in the output only as `os.environ/NAME` references.
"""
from __future__ import annotations

import argparse
import sys

import keypool_config as kc
import yaml


def _prices(models_path=None) -> dict:
    """model id -> (usd per input token, usd per output token) from config/models.yaml price_per_1m."""
    out = {}
    try:
        reg = kc._registry()
        for role in reg.all_role_names(models_path):
            for e in reg.role_entries(role, models_path):
                p = e.get("price_per_1m") or {}
                if e.get("id") and isinstance(p.get("in"), (int, float)) and isinstance(p.get("out"), (int, float)):
                    out.setdefault(e["id"], (p["in"] / 1e6, p["out"] / 1e6))
    except Exception:  # prices are optional: a registry problem must never block the gateway config
        return {}
    return out


def render(pool: dict, names: set[str] | None = None, models_path=None) -> dict:
    gw = pool.get("gateway", {})
    prices = _prices(models_path)
    model_list = []
    fallbacks = []
    for group in pool["groups"]:
        g = pool["groups"][group]
        deps = kc.group_deployments(pool, group, names, models_path)
        # Explicit `fallback:` (tier groups) wins. Otherwise keep the legacy behaviour: a group that
        # mixes tiers moves its paid deployments to "<group>-paid", reached only through a router
        # fallback (providers reject an "order" param).
        if g.get("ordered"):
            # Rank ladder (owner 2026-10-16): each model is its own LiteLLM group holding ALL keys of that model;
            # the group name serves rank 1 and falls back rank by rank, then to the explicit fallbacks. A plain
            # `order` param was tried first: the router spent its retries on the top ranks and never got lower.
            ranks = sorted({d.order for d in deps})
            names_by_rank = {r: group if i == 0 else f"{group}__r{i + 1}" for i, r in enumerate(ranks)}
            fallbacks.append({group: [names_by_rank[r] for r in ranks[1:]] + list(g.get("fallback") or [])})
            for r in ranks[1:]:
                fallbacks.append({names_by_rank[r]: [names_by_rank[x] for x in ranks if x > r] + list(g.get("fallback") or [])})
            for d in deps:
                api_key = "none" if d.keyless else f"os.environ/{d.key_env}"
                params = {"model": d.litellm_model, "api_key": api_key}
                if d.api_base:
                    params["api_base"] = d.api_base
                if d.rpm:
                    params["rpm"] = d.rpm
                if d.tpm:
                    params["tpm"] = d.tpm
                if d.tier != "paid":
                    params["input_cost_per_token"] = params["output_cost_per_token"] = 0.0
                info = {"id": f"{group}:{d.provider}:{d.key_env}:{d.model}", "tier": d.tier, "data_policy": d.data_policy}
                model_list.append({"model_name": names_by_rank[d.order], "litellm_params": params, "model_info": info})
            continue
        explicit = g.get("fallback")
        split = not explicit and any(d.tier == "paid" for d in deps) and any(d.tier != "paid" for d in deps)
        if explicit:
            fallbacks.append({group: list(explicit)})
        elif split:
            fallbacks.append({group: [f"{group}-paid"]})
        for d in deps:
            name = f"{group}-paid" if split and d.tier == "paid" else group
            api_key = "none" if d.keyless else f"os.environ/{d.key_env}"
            params = {"model": d.litellm_model, "api_key": api_key}
            if d.api_base:
                params["api_base"] = d.api_base
            if d.rpm:
                params["rpm"] = d.rpm
            if d.tpm:
                params["tpm"] = d.tpm
            if d.extra_body:
                params["extra_body"] = d.extra_body
            if d.tier != "paid":  # free tiers cost us nothing; LiteLLM would log the list price
                params["input_cost_per_token"] = params["output_cost_per_token"] = 0.0
            elif d.model in prices:  # LiteLLM has no price for some ids: give ours
                params["input_cost_per_token"], params["output_cost_per_token"] = prices[d.model]
            info = {"id": f"{group}:{d.provider}:{d.key_env}:{d.model}", "tier": d.tier, "data_policy": d.data_policy}
            if d.mode:
                info["mode"] = d.mode
            model_list.append({
                "model_name": name,
                "litellm_params": params,
                "model_info": info,
            })
    router = dict(gw.get("router", {}))
    if fallbacks:
        router["fallbacks"] = router.get("fallbacks", []) + fallbacks
    settings = {"drop_params": True, "telemetry": False, "num_retries": router.get("num_retries", 3)}
    if gw.get("cost_log"):
        # LiteLLM loads custom callbacks from the config dir; cost_logger.py is mounted there.
        settings["callbacks"] = ["cost_logger.proxy_handler_instance"]
    return {
        "model_list": model_list,
        "router_settings": router,
        "litellm_settings": settings,
        "general_settings": {"master_key": f"os.environ/{gw.get('master_key_env', 'KEYPOOL_MASTER_KEY')}"},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool")
    ap.add_argument("--env-file")
    ap.add_argument("--out", default="-")
    a = ap.parse_args()
    try:
        pool = kc.load_pool(a.pool)
        names = None
        if a.env_file:
            names = set(kc.parse_env_names(a.env_file, kc.all_key_names(pool)))
        cfg = render(pool, names)
    except kc.PoolError as exc:
        print(f"render_litellm: {exc}", file=sys.stderr)
        return 2
    text = "# GENERATED by render_litellm.py from config/key_pool.yaml. Do not edit.\n" + yaml.safe_dump(cfg, sort_keys=False)
    if a.out == "-":
        sys.stdout.write(text)
    else:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        counts = {g: sum(1 for m in cfg["model_list"] if m["model_name"] == g) for g in pool["groups"]}
        print(f"render_litellm: wrote {a.out} deployments per group: {counts}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
