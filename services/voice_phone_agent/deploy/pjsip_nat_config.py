#!/usr/bin/env python3
"""PJSIP NAT and registration resilience configuration tuner for Asterisk bridge.

Idempotently configures and verifies Asterisk res_pjsip settings to ensure stable SIP trunk
registration and audio traversal behind NAT and firewalls:
1. Transport: RFC 1918 / loopback `local_net` entries and optional external addresses.
2. Endpoint: `rtp_symmetric=yes`, `force_rport=yes`, `rewrite_contact=yes`, `direct_media=no`.
3. Registration: `max_retries=10000`, `retry_interval=60`, `forbidden_retry_interval=300`,
   `fatal_retry_interval=300` (prevents permanent 'Unregistered' after temporary network drops).
4. AOR: `qualify_frequency=20` (keeps UDP conntrack / NAT mapping open).

Privacy: Never prints or logs passwords, hashes, secret tokens, or usernames.
Stdlib only.
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

STANDARD_LOCAL_NETS = (
    "127.0.0.1/32",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
)

REQUIRED_ENDPOINT_PARAMS = {
    "rtp_symmetric": "yes",
    "force_rport": "yes",
    "rewrite_contact": "yes",
    "direct_media": "no",
}

REQUIRED_REGISTRATION_PARAMS = {
    "max_retries": "10000",
    "retry_interval": "60",
    "forbidden_retry_interval": "300",
    "fatal_retry_interval": "300",
}

REQUIRED_AOR_PARAMS = {
    "qualify_frequency": "20",
}


def parse_ini_sections(text: str) -> list[dict]:
    """Parse an Asterisk ini file into structured sections.

    Preserves exact lines, comments, and order.
    """
    lines = text.splitlines(keepends=True)
    sections = []
    current_sec = {
        "header": None,
        "name": "",
        "type": "",
        "lines": [],
        "params": {},  # key_lower -> list of (raw_key, val, line_idx)
    }

    sec_re = re.compile(r"^[ \t]*\[([a-zA-Z0-9_\-\.]+)\](?:[ \t]*\(([^)]+)\))?")
    param_re = re.compile(r"^[ \t]*([a-zA-Z0-9_\-\.]+)[ \t]*=[ \t]*(.*)")

    for line in lines:
        sm = sec_re.match(line)
        if sm:
            if current_sec["header"] is not None or current_sec["lines"]:
                sections.append(current_sec)
            sec_name = sm.group(1)
            current_sec = {
                "header": line,
                "name": sec_name,
                "type": "",
                "lines": [],
                "params": {},
            }
            continue

        current_sec["lines"].append(line)
        pm = param_re.match(line)
        if pm:
            k = pm.group(1).strip()
            v = pm.group(2).split(";")[0].strip()
            kl = k.lower()
            if kl == "type":
                current_sec["type"] = v.lower()
            if kl not in current_sec["params"]:
                current_sec["params"][kl] = []
            current_sec["params"][kl].append((k, v, len(current_sec["lines"]) - 1))

    if current_sec["header"] is not None or current_sec["lines"]:
        sections.append(current_sec)

    return sections


def audit_pjsip_config(text: str, aor_name: str | None = None) -> dict:
    """Audit pjsip.conf for NAT, keepalive, and retry resilience."""
    sections = parse_ini_sections(text)
    issues: list[str] = []
    found_types: set[str] = set()

    for sec in sections:
        stype = sec["type"]
        sname = sec["name"]
        if stype:
            found_types.add(stype)

        # 1. Transport UDP checks
        if stype == "transport" or "transport" in sname.lower():
            proto_param = sec["params"].get("protocol", [])
            is_udp = not proto_param or any(p[1].lower() == "udp" for p in proto_param)
            if is_udp:
                existing_ln = [p[1] for p in sec["params"].get("local_net", [])]
                for req_ln in STANDARD_LOCAL_NETS:
                    if req_ln not in existing_ln:
                        issues.append(f"Section [{sname}]: missing local_net={req_ln}")

        # 2. Endpoint NAT checks
        is_endpoint = stype == "endpoint" or (
            not stype and ("endpoint" in sname.lower() or sname.endswith("_ep"))
        )
        if is_endpoint:
            for k, expected_v in REQUIRED_ENDPOINT_PARAMS.items():
                p_list = sec["params"].get(k, [])
                if not p_list:
                    issues.append(f"Section [{sname}]: missing {k}={expected_v}")
                elif p_list[-1][1].lower() != expected_v.lower():
                    issues.append(f"Section [{sname}]: {k}={p_list[-1][1]} (expected {expected_v})")

        # 3. Registration retry resilience checks
        is_registration = stype == "registration" or (
            not stype and ("reg" in sname.lower() or sname.endswith("_reg"))
        )
        if is_registration:
            for k, expected_v in REQUIRED_REGISTRATION_PARAMS.items():
                p_list = sec["params"].get(k, [])
                if not p_list:
                    issues.append(f"Section [{sname}]: missing {k}={expected_v}")
                elif p_list[-1][1].strip() != expected_v.strip():
                    issues.append(f"Section [{sname}]: {k}={p_list[-1][1]} (expected {expected_v})")

        # 4. AOR qualify checks
        is_aor = stype == "aor" or (
            not stype and ("aor" in sname.lower() or sname.endswith("_aor"))
        )
        if is_aor:
            if aor_name is None or sec["name"] == aor_name:
                q_list = sec["params"].get("qualify_frequency", [])
                if not q_list:
                    issues.append(f"Section [{sname}]: missing qualify_frequency=20")
                elif q_list[-1][1].strip() != "20":
                    msg = f"Section [{sname}]: qualify_frequency={q_list[-1][1]} (expected 20)"
                    issues.append(msg)

    return {
        "compliant": len(issues) == 0,
        "issues": issues,
        "sections": [s["name"] for s in sections if s["name"]],
        "types": sorted(found_types),
    }


def tune_pjsip_config(
    text: str,
    aor_name: str | None = None,
    external_signaling_address: str | None = None,
    external_media_address: str | None = None,
) -> tuple[str, bool]:
    """Tune pjsip.conf to ensure NAT traversal and registration resilience settings are in place."""
    sections = parse_ini_sections(text)
    modified = False
    output_parts = []

    for sec in sections:
        stype = sec["type"]
        sname = sec["name"]
        lines = list(sec["lines"])

        # Top preamble (before any section header)
        if sec["header"] is None:
            output_parts.extend(lines)
            continue

        output_parts.append(sec["header"])

        # 1. Transport UDP
        if stype == "transport" or "transport" in sname.lower():
            proto_param = sec["params"].get("protocol", [])
            is_udp = not proto_param or any(p[1].lower() == "udp" for p in proto_param)
            if is_udp:
                existing_ln = {p[1] for p in sec["params"].get("local_net", [])}
                add_ln = [ln for ln in STANDARD_LOCAL_NETS if ln not in existing_ln]
                if add_ln:
                    for ln in add_ln:
                        lines.append(f"local_net={ln}\n")
                    modified = True

                if external_signaling_address:
                    lines, ch = _set_or_replace_param(
                        lines, "external_signaling_address", external_signaling_address
                    )
                    modified = modified or ch
                if external_media_address:
                    lines, ch = _set_or_replace_param(
                        lines, "external_media_address", external_media_address
                    )
                    modified = modified or ch

        # 2. Endpoint
        is_endpoint = stype == "endpoint" or (
            not stype and ("endpoint" in sname.lower() or sname.endswith("_ep"))
        )
        if is_endpoint:
            for k, v in REQUIRED_ENDPOINT_PARAMS.items():
                lines, ch = _set_or_replace_param(lines, k, v)
                modified = modified or ch

        # 3. Registration
        is_registration = stype == "registration" or (
            not stype and ("reg" in sname.lower() or sname.endswith("_reg"))
        )
        if is_registration:
            for k, v in REQUIRED_REGISTRATION_PARAMS.items():
                lines, ch = _set_or_replace_param(lines, k, v)
                modified = modified or ch

        # 4. AOR
        is_aor = stype == "aor" or (
            not stype and ("aor" in sname.lower() or sname.endswith("_aor"))
        )
        if is_aor:
            if aor_name is None or sname == aor_name:
                for k, v in REQUIRED_AOR_PARAMS.items():
                    lines, ch = _set_or_replace_param(lines, k, v)
                    modified = modified or ch

        output_parts.extend(lines)

    result = "".join(output_parts)
    return result, modified


def _set_or_replace_param(lines: list[str], key: str, value: str) -> tuple[list[str], bool]:
    """Idempotently set or update a parameter in a list of lines."""
    pattern = re.compile(r"^[ \t]*" + re.escape(key) + r"[ \t]*=[ \t]*(.*)", re.IGNORECASE)
    found = False
    modified = False
    new_lines = []

    for line in lines:
        m = pattern.match(line)
        if m:
            found = True
            current_val = m.group(1).split(";")[0].strip()
            if current_val != value:
                # Preserve inline comment if present
                comment = ""
                if ";" in line:
                    comment = " ;" + line.split(";", 1)[1].rstrip("\r\n")
                new_lines.append(f"{key}={value}{comment}\n")
                modified = True
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    if not found:
        # Append before trailing blank lines if possible
        insert_idx = len(new_lines)
        while insert_idx > 0 and new_lines[insert_idx - 1].strip() == "":
            insert_idx -= 1
        new_lines.insert(insert_idx, f"{key}={value}\n")
        modified = True

    return new_lines, modified


def apply_pjsip_nat(
    target_path: Path,
    aor_name: str | None = None,
    dry_run: bool = False,
    external_ip: str | None = None,
) -> int:
    """Read target pjsip.conf, tune NAT and retry settings, and write back atomically."""
    if not target_path.exists():
        sys.stderr.write(f"Error: {target_path} not found\n")
        return 2

    try:
        content = target_path.read_text(encoding="utf-8", errors="replace")
    except OSError as err:
        sys.stderr.write(f"Error reading {target_path}: {err}\n")
        return 2

    tuned, changed = tune_pjsip_config(
        content,
        aor_name=aor_name,
        external_signaling_address=external_ip,
        external_media_address=external_ip,
    )

    if not changed:
        print(f"OK: {target_path} is already compliant with NAT and retry settings")
        return 0

    if dry_run:
        print(f"DRY RUN: {target_path} would be updated:")
        diff = difflib.unified_diff(
            content.splitlines(),
            tuned.splitlines(),
            fromfile=str(target_path),
            tofile=f"{target_path} (tuned)",
            lineterm="",
        )
        for line in diff:
            print(line)
        return 0

    # Write atomically in place: single-file bind mounts in docker fail on rename (sed -i),
    # so we write to a temporary file and copy contents directly over target_path.
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="pjsip_tuned_", dir=str(target_path.parent))
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(tuned)
        shutil.copymode(target_path, tmp_path)
        with open(tmp_path, "rb") as src, open(target_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    print(f"SUCCESS: updated {target_path} with NAT and registration retry resilience")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", help="Check pjsip.conf and exit 0 if compliant, 1 if issues")
    group.add_argument("--apply", help="Apply NAT and registration retry resilience settings")
    group.add_argument("--diff", help="Print unified diff of proposed NAT changes")

    parser.add_argument(
        "--aor",
        default=os.environ.get("PHONE_SIP_AOR", "sabanet_aor"),
        help="Specific AOR section name (default: $PHONE_SIP_AOR or sabanet_aor)",
    )
    parser.add_argument(
        "--external-ip",
        default=os.environ.get("PHONE_EXTERNAL_IP"),
        help="Optional external IP for signaling and media addresses",
    )
    parser.add_argument("--dry-run", action="store_true", help="Simulate apply without writing")

    args = parser.parse_args(argv)

    if args.check:
        target = Path(args.check)
        if not target.exists():
            sys.stderr.write(f"Error: {target} does not exist\n")
            return 2
        content = target.read_text(encoding="utf-8", errors="replace")
        report = audit_pjsip_config(content, aor_name=args.aor)
        if report["compliant"]:
            print(f"OK: {target} is fully compliant with NAT and retry settings")
            return 0
        else:
            print(f"NON-COMPLIANT: {len(report['issues'])} issue(s) found in {target}:")
            for issue in report["issues"]:
                print(f"  - {issue}")
            return 1

    if args.diff:
        target = Path(args.diff)
        if not target.exists():
            sys.stderr.write(f"Error: {target} does not exist\n")
            return 2
        content = target.read_text(encoding="utf-8", errors="replace")
        tuned, changed = tune_pjsip_config(
            content,
            aor_name=args.aor,
            external_signaling_address=args.external_ip,
            external_media_address=args.external_ip,
        )
        if not changed:
            print(f"OK: {target} has no diff (already compliant)")
            return 0
        diff = difflib.unified_diff(
            content.splitlines(),
            tuned.splitlines(),
            fromfile=str(target),
            tofile=f"{target} (proposed)",
            lineterm="",
        )
        for line in diff:
            print(line)
        return 0

    if args.apply:
        target = Path(args.apply)
        return apply_pjsip_nat(
            target,
            aor_name=args.aor,
            dry_run=args.dry_run,
            external_ip=args.external_ip,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
