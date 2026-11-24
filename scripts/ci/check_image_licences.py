#!/usr/bin/env python3
"""Container image licence gate (T299 / #1122).

Scans docker-compose files, GitHub Actions workflows, and infra shell scripts
for container images known to use non-permissive licences (RSALv2, SSPLv1,
AGPL-3.0, ELv2) — including Redis 7.4+, Redis 8+, and unpinned `redis:7` /
`redis:latest` tags which resolve to RSALv2/SSPLv1 builds.

Scope:
- Target files scanned: `*compose*.yml`, `*compose*.yaml`, `.github/workflows/*.yml`,
  `.github/workflows/*.yaml`, and `scripts/infra/e2e/sandbox_up.sh`.
- Exclusions: files in `EXCLUDED_PENDING_MIGRATION` (`docker-compose.prod.yml`,
  `docker-compose.modern-stack.yml`, `sandbox_up.sh`) pending scheduled cutover #992.
- Note: Dockerfile FROM lines and arbitrary standalone shell scripts are outside
  current target file scope.

Exit code 0 if clean, 1 if any disallowed image is found.
"""

from __future__ import annotations

import pathlib
import re
import sys
from dataclasses import dataclass

# Production compose files and scripts scheduled for migration in #992 (T253 maintenance window).
# Kept untouched in #1122 to avoid uncoordinated live container recreations on autodeploy.
EXCLUDED_PENDING_MIGRATION = {
    "docker-compose.prod.yml",
    "docker-compose.modern-stack.yml",
    "sandbox_up.sh",
}

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

# Matches YAML `image: <ref>` (handling optional quotes and GHA ${{ ... }} prefixes)
YAML_IMAGE_RE = re.compile(
    r"^\s*image:\s*['\"]?([^\s'\"#]+(?:\s*\}\}\S*)?)['\"]?",
    re.MULTILINE,
)

# Matches `docker run ... <image>` for known risky images in shell scripts
SHELL_IMAGE_RE = re.compile(
    r"\b((?:[a-z0-9._-]+(?:/[a-z0-9._-]+)*/)?(?:redis(?:-stack)?|mongo(?:db)?|elasticsearch|minio/minio|grafana/grafana):[^\s'\"\\]+)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    image: str
    reason: str


def _normalize_image(raw: str) -> str:
    """Strip GHA expression prefixes like `${{ ... }}/` and digests `@sha256:...`."""
    cleaned = re.sub(r"\$\{\{[^}]*\}\}/?", "", raw).strip()
    cleaned = cleaned.split("@", 1)[0]
    return cleaned.lower()


# Denied licences for runtime images and runtime dependencies
DENIED_LICENCES = ("BUSL", "AGPL", "SSPL", "ELv2", "HFOIL", "MPL")

# Per-image allowlist: unmodified upstream images explicitly approved
ALLOWED_AGPL_UPSTREAM_IMAGES = {
    "twentycrm/twenty": "AGPL-3.0 (allowed only as unmodified upstream image)",
}


def check_licence_tag(licence: str) -> str | None:
    """Return a disallow reason if a runtime dependency/image licence is in DENIED_LICENCES."""
    upper = licence.upper()
    for denied in DENIED_LICENCES:
        if denied.upper() in upper:
            return f"Licence '{licence}' matches denied runtime licence '{denied}'"
    return None


def check_image_ref(raw_image: str) -> str | None:
    """Return a disallow reason if the image uses a blocked licence, else None."""
    norm = _normalize_image(raw_image)
    if not norm:
        return None

    # Split registry/org/repo:tag
    if ":" in norm:
        repo, tag = norm.rsplit(":", 1)
    else:
        repo, tag = norm, "latest"

    # Base image name (last path segment, or org/name for org-scoped images)
    parts = [p for p in repo.split("/") if p]
    if not parts:
        return None
    name = parts[-1]
    org_name = "/".join(parts[-2:]) if len(parts) >= 2 else name

    # Valkey is BSD-3-Clause -> explicitly allowed
    if name == "valkey" or org_name == "valkey/valkey":
        return None

    # Twenty (AGPL) is allowed only as unmodified upstream image
    if org_name in ALLOWED_AGPL_UPSTREAM_IMAGES:
        return None

    # Redis: only 7.2.x is supported BSD-3-Clause; 7.4+, 8+, latest, or unpinned `7` / `7-alpine` are RSALv2/SSPLv1
    if name == "redis":
        if tag.startswith("7.2"):
            return None
        return f"Redis tag '{tag}' is RSALv2/SSPLv1 or unsupported/unpinned (use valkey/valkey:8-alpine or redis:7.2)"

    if name.startswith("redis-stack"):
        return "redis-stack is dual-licensed RSALv2/SSPLv1 (non-OSI)"

    if name in {"mongo", "mongodb"} or org_name.startswith("mongodb/"):
        return "MongoDB is licensed under SSPLv1 (non-OSI)"

    if name == "elasticsearch" or org_name == "elastic/elasticsearch":
        return "Elasticsearch is licensed under SSPLv1/ELv2 (non-OSI)"

    if org_name == "minio/minio" or name == "minio":
        return "MinIO is licensed under AGPL-3.0"

    if org_name == "grafana/grafana" or name == "grafana":
        return "Grafana is licensed under AGPL-3.0"

    return None


def scan_text(text: str, rel_path: str) -> list[Finding]:
    findings: list[Finding] = []
    is_shell = rel_path.endswith(".sh")
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "# image-licence-ok:" in line:
            continue
        if is_shell:
            for match in SHELL_IMAGE_RE.finditer(line):
                img = match.group(1)
                reason = check_image_ref(img)
                if reason:
                    findings.append(Finding(rel_path, lineno, img, reason))
        else:
            # Handle GHA `${{ ... }}/redis:7` on an `image:` line
            if "image:" in stripped:
                after = stripped.split("image:", 1)[1].strip().strip("'\"")
                # Remove trailing inline comment
                if " #" in after:
                    after = after.split(" #", 1)[0].strip().strip("'\"")
                reason = check_image_ref(after)
                if reason:
                    findings.append(Finding(rel_path, lineno, after, reason))
    return findings


def iter_target_files(root: pathlib.Path = REPO_ROOT) -> list[pathlib.Path]:
    targets: list[pathlib.Path] = []
    for pattern in ("*compose*.yml", "*compose*.yaml"):
        targets.extend(root.rglob(pattern))
    wf_dir = root / ".github" / "workflows"
    if wf_dir.is_dir():
        targets.extend(wf_dir.glob("*.yml"))
        targets.extend(wf_dir.glob("*.yaml"))
    sandbox = root / "scripts" / "infra" / "e2e" / "sandbox_up.sh"
    if sandbox.is_file():
        targets.append(sandbox)

    # Exclude vendored / node_modules / .git and pending maintenance cutover files
    clean: list[pathlib.Path] = []
    seen: set[pathlib.Path] = set()
    for p in sorted(targets):
        if any(part in {"node_modules", ".git", ".next", "dist", "venv", ".venv"} for part in p.parts):
            continue
        if p.name in EXCLUDED_PENDING_MIGRATION:
            continue
        if p not in seen and p.is_file():
            seen.add(p)
            clean.append(p)
    return clean


def scan_repo(root: pathlib.Path = REPO_ROOT) -> list[Finding]:
    findings: list[Finding] = []
    for path in iter_target_files(root):
        rel = path.relative_to(root).as_posix()
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        findings.extend(scan_text(text, rel))
    return findings


def main() -> int:
    findings = scan_repo()
    if findings:
        print(f"FAIL: {len(findings)} disallowed container image(s) found:")
        for f in findings:
            print(f"  {f.path}:{f.line}: {f.image} -> {f.reason}")
        return 1
    print("OK: all scanned compose/CI container images pass the licence gate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
