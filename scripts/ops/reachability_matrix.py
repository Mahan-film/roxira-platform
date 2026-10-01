#!/usr/bin/env python3
"""Report DNS reachability and HTTPS HEAD results without credentials."""

from __future__ import annotations

import argparse
import http.client
import ipaddress
import json
import socket
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

ENDPOINTS = (
    "github.com", "api.github.com", "ghcr.io", "registry-1.docker.io",
    "registry.npmjs.org", "pypi.org", "openrouter.ai", "api.groq.com",
    "api.mistral.ai", "api.siliconflow.com", "huggingface.co",
    "objects.githubusercontent.com", "productionresultssa3.blob.core.windows.net",
    "ghazihoushmand.ir", "roxira.ir",
)
FILTERED_NETWORKS = (ipaddress.ip_network("10.10.34.0/24"), ipaddress.ip_network("10.10.35.0/24"))
Resolver = Callable[[str], list[str]]
HeadClient = Callable[[str, float], int]


def resolve_a_records(endpoint: str) -> list[str]:
    records = socket.getaddrinfo(endpoint, 443, family=socket.AF_INET, type=socket.SOCK_STREAM)
    return sorted({record[4][0] for record in records})


def https_head(endpoint: str, timeout: float) -> int:
    connection = http.client.HTTPSConnection(endpoint, timeout=timeout)
    try:
        # Deliberately omit Host, Accept-Encoding, and all custom headers.
        connection.putrequest("HEAD", "/", skip_host=True, skip_accept_encoding=True)
        connection.endheaders()
        return connection.getresponse().status
    finally:
        connection.close()


def run_matrix(
    resolver: Resolver = resolve_a_records, client: HeadClient = https_head, timeout: float = 8.0,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for endpoint in ENDPOINTS:
        result: dict[str, Any] = {"endpoint": endpoint, "addresses": [], "filtered_dns": False,
                                  "status_code": None, "latency_ms": None, "error": None}
        try:
            addresses = resolver(endpoint)
            result["addresses"] = addresses
            result["filtered_dns"] = any(
                ipaddress.ip_address(address) in network for address in addresses for network in FILTERED_NETWORKS
            )
        except Exception as error:  # DNS failures are a result, not a script failure.
            result["error"] = f"dns: {error}"
        started = time.monotonic()
        try:
            result["status_code"] = client(endpoint, timeout)
            result["latency_ms"] = round((time.monotonic() - started) * 1000)
        except Exception as error:  # Timeouts and TLS errors are reported per endpoint.
            result["error"] = result["error"] or f"https: {error}"
            result["latency_ms"] = round((time.monotonic() - started) * 1000)
        results.append(result)
    return {"checked_at": datetime.now(timezone.utc).isoformat(), "host": socket.gethostname(), "results": results}


def render_table(report: dict[str, Any]) -> str:
    lines = ["endpoint\taddresses\tfiltered_dns\tstatus\tlatency_ms\terror"]
    for item in report["results"]:
        lines.append("\t".join(str(item[key]) if key != "addresses" else ",".join(item[key]) for key in
                               ("endpoint", "addresses", "filtered_dns", "status_code", "latency_ms", "error")))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", choices=("json", "table"), default="json")
    parser.add_argument("--fail-on-filtered", action="store_true")
    args = parser.parse_args()
    report = run_matrix()
    print(render_table(report) if args.format == "table" else json.dumps(report, indent=2))
    return int(args.fail_on_filtered and any(item["filtered_dns"] for item in report["results"]))


if __name__ == "__main__":
    raise SystemExit(main())
