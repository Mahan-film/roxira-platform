"""Report unsafe Docker Compose settings without requiring an OPA runtime."""

import argparse
from pathlib import Path
from typing import Any, Sequence
ALLOWED_PUBLIC = {"nginx_gateway": {80, 443}}

def _mounts_docker_socket(volume: Any) -> bool:
    if isinstance(volume, str):
        return "/var/run/docker.sock" in volume
    if isinstance(volume, dict):
        return any(volume.get(field) == "/var/run/docker.sock" for field in ("source", "target"))
    return False

def _published_port(port: Any) -> tuple[str | None, int | None] | None:
    if isinstance(port, dict):
        if port.get("published") is None:
            return None
        host = port.get("host_ip")
        target = port.get("target")
    elif isinstance(port, str | int):
        parts = str(port).split("/")[0].split(":")
        host = ":".join(parts[:-2]) if len(parts) > 2 else None
        target = parts[-1]
    else:
        return None
    try:
        return str(host) if host is not None else None, int(str(target).split("-")[0])
    except (TypeError, ValueError):
        return str(host) if host is not None else None, None

def check(compose: dict) -> list[str]:
    """Return policy findings for a parsed Compose document."""
    findings: list[str] = []
    services = compose.get("services", {})
    if not isinstance(services, dict):
        return findings
    for name, service in services.items():
        if not isinstance(service, dict):
            continue
        prefix = str(name)
        if service.get("privileged") is True:
            findings.append(f"{prefix}: privileged containers are prohibited")
        if any(_mounts_docker_socket(volume) for volume in service.get("volumes", [])):
            findings.append(f"{prefix}: Docker socket mounts are prohibited")
        image = service.get("image")
        if isinstance(image, str) and (image.endswith(":latest") or ":" not in image.rsplit("/", 1)[-1]):
            findings.append(f"{prefix}: image must use a non-latest tag")
        limits = service.get("deploy", {}).get("resources", {}).get("limits", {})
        if not service.get("mem_limit") and not limits.get("memory"):
            findings.append(f"{prefix}: memory limit is required")
        for port in service.get("ports", []):
            published = _published_port(port)
            if published is None:
                continue
            host, target = published
            if host != "127.0.0.1" and target not in ALLOWED_PUBLIC.get(prefix, set()):
                findings.append(f"{prefix}: published ports must bind to 127.0.0.1")
        if service.get("network_mode") == "host":
            findings.append(f"{prefix}: host network mode is prohibited")
    return findings

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--strict", action="store_true", help="exit non-zero when findings exist")
    args = parser.parse_args(argv)
    import yaml
    findings = []
    for path in args.files:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        for finding in check(document if isinstance(document, dict) else {}):
            print(f"{path}: {finding}")
            findings.append(finding)
    return 1 if args.strict and findings else 0

if __name__ == "__main__":
    raise SystemExit(main())
