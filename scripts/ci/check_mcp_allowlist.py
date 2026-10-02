#!/usr/bin/env python3
"""Check every MCP server in .mcp.json is allowlisted in config/mcp_allowlist.yaml.

Implements the MCP containment rule in
docs/research/nextgen/A_agent_native_architecture.md §2. Exits 1 with a list of
problems when a configured server is not allowlisted, an allowlist entry is
expired, a transport/data_class is unknown, or an http server has no named
network host. Exits 0 with a short OK message otherwise; --report-only always
exits 0.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
MCP_CONFIG = ROOT / ".mcp.json"
ALLOWLIST = ROOT / "config" / "mcp_allowlist.yaml"

TRANSPORTS = {"stdio", "http"}
DATA_CLASSES = {"public", "code", "none"}


def load_servers(path):
    """Return {name: spec} from a .mcp.json document."""
    data = json.loads(path.read_text(encoding="utf-8"))
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        return {}
    return {str(name): (spec if isinstance(spec, dict) else {}) for name, spec in servers.items()}


def load_allowlist(path):
    """Return the list of allowlist entry dicts from the YAML document."""
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries = data.get("servers")
    if not isinstance(entries, list):
        return []
    return [entry for entry in entries if isinstance(entry, dict)]


def _has_network(network):
    """True when an entry declares at least one concrete network host."""
    if isinstance(network, str):
        return network.strip().lower() not in {"", "none"}
    if isinstance(network, list):
        return any(str(host).strip() for host in network)
    return False


def check(servers, entries, today=None):
    """Return a sorted list of human-readable problems (empty when all good)."""
    today = today or date.today()
    problems = []
    by_name = {}
    for entry in entries:
        name = entry.get("name")
        if not isinstance(name, str) or not name:
            problems.append("allowlist entry without a name")
            continue
        if name in by_name:
            problems.append(f"{name}: duplicate allowlist entry")
            continue
        by_name[name] = entry

    for name in sorted(servers):
        if name not in by_name:
            problems.append(f"{name}: configured in .mcp.json but not allowlisted")

    for name in sorted(by_name):
        entry = by_name[name]
        transport = entry.get("transport")
        if transport not in TRANSPORTS:
            problems.append(f"{name}: unknown transport {transport!r}")
        data_class = entry.get("data_class")
        if data_class not in DATA_CLASSES:
            problems.append(f"{name}: unknown data_class {data_class!r}")
        expires = entry.get("expires")
        expiry = None
        if isinstance(expires, str):
            try:
                expiry = date.fromisoformat(expires)
            except ValueError:
                problems.append(f"{name}: expires is not YYYY-MM-DD: {expires!r}")
        if expiry is None:
            if not isinstance(expires, str):
                problems.append(f"{name}: missing expires")
        elif expiry < today:
            problems.append(f"{name}: allowlist entry expired on {expiry.isoformat()}")
        if transport == "http" and not _has_network(entry.get("network")):
            problems.append(f"{name}: http server needs a named network host")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-only", action="store_true", help="always exit 0")
    parser.add_argument("--config", type=Path, default=MCP_CONFIG, help="path to .mcp.json")
    parser.add_argument(
        "--allowlist", type=Path, default=ALLOWLIST, help="path to the YAML allowlist"
    )
    args = parser.parse_args(argv)

    try:
        servers = load_servers(args.config)
        entries = load_allowlist(args.allowlist)
    except (OSError, ValueError, yaml.YAMLError) as error:
        servers, entries = {}, []
        problems = [f"cannot load allowlist inputs: {error}"]
    else:
        problems = check(servers, entries)

    if problems:
        print("MCP allowlist check failed:")
        for problem in problems:
            print(f"  - {problem}")
        return 0 if args.report_only else 1
    print(f"MCP allowlist OK ({len(entries)} server(s) allowlisted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
