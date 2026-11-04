#!/usr/bin/env python3
"""Backup e-mail reports and "offsite by e-mail" delivery. Standard library only.

Two sub-commands (credentials come from the environment, same names as notify_email.py:
BACKUP_SMTP_USER, BACKUP_SMTP_PASS, BACKUP_NOTIFY_TO, optional BACKUP_SMTP_HOST/PORT/NOTIFY_FROM):

  report   Build backup-report-<date>.md + manifest-<date>.json from status.env and the sets
           directory (plaintext: sizes, checksums, timings, status; no secrets, no user data)
           and send them as attachments of one mail.
  offsite  Take ONE already age-encrypted file, split it into numbered parts that each fit one
           Gmail message, and mail one part per message together with the manifest. Refuses any
           input that does not start with the age header, so plaintext data can never be mailed.
           Enforces caps; when the data does not fit it sends nothing but a report that says so
           (a partial age stream cannot be restored, so truncating would only burn quota).

Environment tunables (defaults): BACKUP_EMAIL_PART_MB=17 (raw bytes per part; base64 adds ~37 %,
Gmail limit is 25 MB per message), BACKUP_EMAIL_MAX_MAILS=10 (per run), BACKUP_EMAIL_MAX_DAY_MB=150
(per UTC day, counted in a small state file), BACKUP_EMAIL_PAUSE_S=3 (between messages).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import smtplib
import ssl
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

AGE_MAGIC = b"age-encryption.org/v1"
MB = 1024 * 1024
GMAIL_MESSAGE_LIMIT = 25 * MB


class OffsiteError(Exception):
    pass


# ---------------------------------------------------------------- hashing / splitting
def sha256_file(path: Path, chunk: int = 4 * MB) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def assert_age_encrypted(path: Path) -> None:
    with open(path, "rb") as fh:
        head = fh.read(len(AGE_MAGIC))
    if head != AGE_MAGIC:
        raise OffsiteError(f"{path.name} does not start with the age header; refusing to mail it")


@dataclass
class Part:
    index: int
    total: int
    name: str
    size: int
    sha256: str
    path: str = ""


def part_name(base: str, index: int) -> str:
    return f"{base}.part{index:02d}"


def split_file(src: Path, out_dir: Path, part_bytes: int) -> list[Part]:
    """Split src into <src.name>.partNN files of at most part_bytes. Empty input -> OffsiteError."""
    if part_bytes <= 0:
        raise OffsiteError("part size must be positive")
    size = src.stat().st_size
    if size == 0:
        raise OffsiteError("input is empty")
    total = -(-size // part_bytes)
    if total > 99:
        raise OffsiteError(f"{total} parts needed; part numbering supports at most 99")
    out_dir.mkdir(parents=True, exist_ok=True)
    parts: list[Part] = []
    with open(src, "rb") as fh:
        for i in range(1, total + 1):
            p = out_dir / part_name(src.name, i)
            h = hashlib.sha256()
            n = 0
            with open(p, "wb") as out:
                remaining = part_bytes
                while remaining > 0:
                    block = fh.read(min(4 * MB, remaining))
                    if not block:
                        break
                    out.write(block)
                    h.update(block)
                    n += len(block)
                    remaining -= len(block)
            parts.append(Part(i, total, p.name, n, h.hexdigest(), str(p)))
    return parts


def join_parts(part_paths: list[Path], dest: Path) -> str:
    """Concatenate parts in the given order into dest; return the sha256 of the result."""
    h = hashlib.sha256()
    with open(dest, "wb") as out:
        for p in part_paths:
            with open(p, "rb") as fh:
                while True:
                    block = fh.read(4 * MB)
                    if not block:
                        break
                    out.write(block)
                    h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------- caps
@dataclass
class Caps:
    part_bytes: int = 17 * MB
    max_mails: int = 10
    max_day_bytes: int = 150 * MB

    @classmethod
    def from_env(cls, env=os.environ) -> "Caps":
        return cls(
            part_bytes=int(float(env.get("BACKUP_EMAIL_PART_MB", "17")) * MB),
            max_mails=int(env.get("BACKUP_EMAIL_MAX_MAILS", "10")),
            max_day_bytes=int(float(env.get("BACKUP_EMAIL_MAX_DAY_MB", "150")) * MB),
        )


def check_caps(total_bytes: int, n_parts: int, caps: Caps, sent_today_bytes: int = 0) -> str | None:
    """Return None when the payload fits, else a human-readable reason (never truncates)."""
    if caps.part_bytes * 4 // 3 + 4096 > GMAIL_MESSAGE_LIMIT:
        return f"configured part size {caps.part_bytes} B would exceed Gmail's 25 MB message limit after base64"
    if n_parts > caps.max_mails:
        return f"{n_parts} mails needed, per-run cap is {caps.max_mails}"
    if total_bytes + sent_today_bytes > caps.max_day_bytes:
        return (f"{total_bytes} B plus {sent_today_bytes} B already sent today exceeds the daily cap "
                f"of {caps.max_day_bytes} B")
    return None


def read_day_state(path: Path, today: str) -> dict:
    try:
        d = json.loads(path.read_text())
        if d.get("date") == today:
            return d
    except (OSError, ValueError):
        pass
    return {"date": today, "bytes": 0, "mails": 0}


def write_day_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state))
    tmp.replace(path)


# ---------------------------------------------------------------- manifests
def build_offsite_manifest(date: str, host: str, src_name: str, src_size: int, src_sha: str,
                           parts: list[Part], caps: Caps, status: str = "OK", note: str = "") -> dict:
    return {
        "kind": "offsite",
        "version": 1,
        "date": date,
        "host": host,
        "status": status,
        "note": note,
        "encryption": "age (recipient: owner public key); decrypt with the private key backup-age.key",
        "source": {"name": src_name, "bytes": src_size, "sha256": src_sha},
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data": "fresh pg_dump taken for this mail (not copied from a local set)",
        "part_bytes_max": caps.part_bytes,
        "parts": [{"index": p.index, "total": p.total, "name": p.name, "bytes": p.size, "sha256": p.sha256}
                  for p in parts],
        "caps": asdict(caps),
    }


def parse_status_env(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)='(.*)'$", line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def human(n: float) -> str:
    n = float(n)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024 or unit == "TiB":
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TiB"


def scan_sets(sets_dir: Path, hash_max_bytes: int) -> list[dict]:
    """Per-set summary: name, bytes, file count, and sha256 of files up to hash_max_bytes."""
    sets = []
    if not sets_dir.is_dir():
        return sets
    latest = None
    link = sets_dir / "latest"
    if link.exists():
        latest = link.resolve().name
    for d in sorted((x for x in sets_dir.iterdir() if x.is_dir() and not x.is_symlink()), reverse=True):
        files = []
        total = 0
        for f in sorted(d.rglob("*")):
            if f.is_file():
                sz = f.stat().st_size
                total += sz
                entry = {"path": str(f.relative_to(d)), "bytes": sz, "sha256": None}
                if d.name == latest and sz <= hash_max_bytes:
                    entry["sha256"] = sha256_file(f)
                files.append(entry)
        sets.append({"name": d.name, "latest": d.name == latest, "bytes": total,
                     "file_count": len(files), "files": files if d.name == latest else []})
    return sets


SET_TS = "%Y%m%dT%H%M%SZ"


def set_age_hours(name: str, now: datetime) -> float | None:
    try:
        return (now - datetime.strptime(name, SET_TS).replace(tzinfo=timezone.utc)).total_seconds() / 3600
    except ValueError:
        return None


def env_age_hours(value: str, now: datetime) -> float | None:
    return set_age_hours(value, now) if value else None


def freshness(sets: list[dict], status: dict, now: datetime, max_set_h: float, max_r2_h: float,
              max_drill_h: float, expect_r2: bool = False, expect_drill: bool = False) -> dict:
    """Age of the newest set / R2 copy / restore drill against what the schedule allows.
    `problems` lists every age that is over its limit; the report fails on any of them."""
    latest = next((s for s in sets if s["latest"]), sets[0] if sets else None)
    set_age = set_age_hours(latest["name"], now) if latest else None
    r2_age = env_age_hours(status.get("R2_LAST_OK", ""), now)
    drill_age = env_age_hours(status.get("DRILL_AT", ""), now)
    problems = []
    if set_age is None:
        problems.append("no local backup set found")
    elif set_age > max_set_h:
        problems.append(f"latest local set is {set_age:.1f} h old (limit {max_set_h:g} h)")
    if expect_r2 and status.get("R2_LAST_RESULT") is None and r2_age is None:
        problems.append("R2 copy expected (timer enabled) but no result was ever recorded")
    if status.get("R2_LAST_RESULT") is not None or r2_age is not None:
        if r2_age is None or r2_age > max_r2_h:
            problems.append("R2 copy is " + ("missing" if r2_age is None else f"{r2_age:.1f} h old")
                            + f" (limit {max_r2_h:g} h)")
        if status.get("R2_LAST_RESULT", "OK") != "OK":
            problems.append("last R2 upload failed: " + status.get("R2_LAST_ERROR", "unknown"))
    if expect_drill and status.get("DRILL_RESULT") is None:
        problems.append("restore drill expected (timer enabled) but no result was ever recorded")
    if status.get("DRILL_RESULT") is not None:
        if status["DRILL_RESULT"] != "OK":
            problems.append("last restore drill FAILED")
        elif drill_age is None or drill_age > max_drill_h:
            problems.append(f"restore drill is older than {max_drill_h:g} h")
    return {"set_name": latest["name"] if latest else None, "set_age_h": set_age,
            "set_max_age_h": max_set_h, "r2_age_h": r2_age, "r2_max_age_h": max_r2_h,
            "r2_result": status.get("R2_LAST_RESULT", "not configured"),
            "drill_result": status.get("DRILL_RESULT", "never"), "drill_at": status.get("DRILL_AT", "n/a"),
            "drill_age_h": drill_age, "problems": problems}


def build_report_manifest(date: str, host: str, status: dict, sets: list[dict], disk_pct, caps: Caps,
                          offsite: dict | None = None, fresh: dict | None = None) -> dict:
    result = status.get("LAST_RESULT", "UNKNOWN")
    fresh = fresh or {"problems": []}
    if result == "OK" and fresh["problems"]:
        result = "STALE"
    local_only = status.get("BACKUP_MODE") == "local-only"
    return {
        "kind": "report", "version": 1, "date": date, "host": host,
        "status": result,
        "freshness": fresh,
        "last_ok": status.get("LAST_OK", "never"),
        "duration_s": status.get("DURATION_S"),
        "staged_bytes": int(status["STAGE_BYTES"]) if status.get("STAGE_BYTES", "").isdigit() else None,
        "backup_mode": status.get("BACKUP_MODE", "unknown"),
        "restic": {k[5:]: {"snapshot": v, "added": status.get("ADDED_" + k[5:], "n/a")}
                   for k, v in status.items() if k.startswith("SNAP_")},
        # restic_check means nothing without a restic repository: None is rendered as "not applicable".
        "restic_check": None if local_only else
        {"result": status.get("CHECK_RESULT", "never"), "at": status.get("CHECK_AT", "n/a")},
        "warnings": status.get("WARNINGS", ""),
        "last_error": status.get("LAST_ERROR", ""),
        "disk_used_pct": disk_pct,
        "sets": sets,
        "email_caps": asdict(caps),
        "offsite_email": offsite,
    }


def _age(h) -> str:
    return "n/a" if h is None else f"{h:.1f} h"


def _freshness_rows(f: dict | None) -> list[str]:
    if not f or "set_name" not in f:
        return []
    rows = [f"| Latest local set | {f['set_name']} ({_age(f['set_age_h'])} old, limit {f['set_max_age_h']:g} h) |"]
    if f["r2_result"] != "not configured":
        rows.append(f"| R2 copy (hourly) | {f['r2_result']}, {_age(f['r2_age_h'])} old, limit {f['r2_max_age_h']:g} h |")
    rows.append(f"| Restore drill | {f['drill_result']} ({f['drill_at']}) |")
    return rows


def render_report_md(m: dict) -> str:
    ok = m["status"] == "OK"
    L = [f"# Roxira backup report {m['date']}", "",
         f"**Status: {'OK' if ok else 'ATTENTION - ' + m['status']}**  ", f"Host: `{m['host']}`", "",
         "## Summary", "", "| Item | Value |", "|---|---|",
         f"| Last run result | {m['status']} |", f"| Last OK | {m['last_ok']} |",
         f"| Duration | {m['duration_s'] or '?'} s |",
         f"| Staged size | {human(m['staged_bytes']) if m['staged_bytes'] is not None else '?'} |",
         f"| Disk used | {m['disk_used_pct'] if m['disk_used_pct'] is not None else '?'} % |",
         f"| Mode | {m['backup_mode']} |",
         "| Restic check | " + ("not applicable (local-only mode, no restic repository)"
                                  if m["restic_check"] is None else
                                  f"{m['restic_check']['result']} ({m['restic_check']['at']})") + " |",
         *_freshness_rows(m.get("freshness")),
         f"| Warnings | {m['warnings'] or 'none'} |", f"| Last error | {m['last_error'] or 'none'} |", ""]
    if m["restic"]:
        L += ["## Restic repositories", "", "| Repo | Snapshot | Added |", "|---|---|---|"]
        L += [f"| {k} | {v['snapshot']} | {v['added']} |" for k, v in m["restic"].items()]
        L.append("")
    if m.get("freshness", {}).get("problems"):
        L += ["## Stale or failed copies", ""] + [f"- **{p}**" for p in m["freshness"]["problems"]] + [""]
    L += ["## Local sets", "", "| Set | Latest | Size | Files |", "|---|---|---|---|"]
    L += [f"| {s['name']} | {'yes' if s['latest'] else ''} | {human(s['bytes'])} | {s['file_count']} |"
          for s in m["sets"]] or ["| (none) | | | |"]
    L.append("")
    latest = next((s for s in m["sets"] if s["latest"]), None)
    if latest:
        L += [f"## Checksums (SHA-256) of the latest set `{latest['name']}`", "",
              "| File | Size | SHA-256 |", "|---|---|---|"]
        L += [f"| {f['path']} | {human(f['bytes'])} | `{f['sha256'] or 'not hashed (too large)'}` |"
              for f in latest["files"]]
        L.append("")
    off = m.get("offsite_email")
    if off:
        L += ["## Offsite by e-mail", "", f"- Status: **{off['status']}**"]
        if off.get("note"):
            L.append(f"- Note: {off['note']}")
        if off.get("built_at"):
            L.append(f"- Built from a fresh dump at {off['built_at']}")
        if off.get("parts"):
            L.append(f"- Parts: {len(off['parts'])}, total {human(sum(p['bytes'] for p in off['parts']))}")
        L.append("")
    L += ["## Next steps", ""]
    if m["status"] == "STALE":
        L += ["- The backup is older than the schedule allows. Read `Stale or failed copies` above, then "
              "`systemctl list-timers 'roxira-backup-dr*'` and `journalctl -u roxira-backup-dr-run -n 100`."]
    elif ok:
        L.append("- Nothing to do. Keep `backup-age.key` safe; without it the mailed parts cannot be decrypted.")
    else:
        L += ["- Read `last error` above, then `journalctl -u roxira-backup-dr-run -n 100` on the server.",
              "- If the timer stopped, `systemctl list-timers 'roxira-backup-dr*'`."]
    if off and off["status"] != "OK":
        L.append("- Offsite e-mail did not deliver: see the note; raise the caps or trim the payload "
                 "(`BACKUP_EMAIL_MAX_MAILS`, `BACKUP_EMAIL_MAX_DAY_MB`).")
    L += ["- Restore from mailed parts: `scripts/ops/backup/restore_from_email.sh` "
          "(see docs/ops/BACKUP_EMAIL.md).", ""]
    return "\n".join(L)


# ---------------------------------------------------------------- messages / sending
def _attach(msg: EmailMessage, data: bytes, filename: str) -> None:
    ctype, _ = mimetypes.guess_type(filename)
    if filename.endswith((".md",)):
        ctype = "text/markdown"
    maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
    if maintype == "text":  # declare UTF-8 explicitly so Persian text survives
        msg.add_attachment(data.decode("utf-8", errors="replace"), subtype=subtype, charset="utf-8",
                           filename=filename)
        return
    msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)


def make_message(subject: str, body: str, sender: str, to: str, attachments: list[tuple[str, bytes]]) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.set_content(body, charset="utf-8")
    for name, data in attachments:
        _attach(msg, data, name)
    return msg


def send_messages(msgs: list[EmailMessage], smtp_factory, user: str, password: str, pause_s: float = 0,
                  sleep=time.sleep) -> int:
    """Send all messages over one authenticated connection; return how many were sent."""
    sent = 0
    with smtp_factory() as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(user, password)
        for i, m in enumerate(msgs):
            if i and pause_s:
                sleep(pause_s)
            smtp.send_message(m)
            sent += 1
    return sent


def plan_offsite(src: Path, work_dir: Path, date: str, host: str, caps: Caps, sent_today: int = 0):
    """Return (manifest, parts) ; parts is [] when caps are exceeded (manifest.status == 'OVER_CAP')."""
    assert_age_encrypted(src)
    size = src.stat().st_size
    n = -(-size // caps.part_bytes)
    reason = check_caps(size, n, caps, sent_today)
    src_sha = sha256_file(src)
    if reason:
        return build_offsite_manifest(date, host, src.name, size, src_sha, [], caps, "OVER_CAP",
                                      f"NOT SENT: {reason}. Encrypted payload is {human(size)}."), []
    parts = split_file(src, work_dir, caps.part_bytes)
    return build_offsite_manifest(date, host, src.name, size, src_sha, parts, caps), parts


def offsite_messages(manifest: dict, parts: list[Part], sender: str, to: str) -> list[EmailMessage]:
    mj = json.dumps(manifest, indent=2).encode()
    mname = f"offsite-manifest-{manifest['date']}.json"
    msgs = []
    for p in parts:
        body = (f"Roxira offsite backup {manifest['date']} - part {p.index:02d} of {p.total:02d}\n\n"
                f"file   : {p.name}\nbytes  : {p.size}\nsha256 : {p.sha256}\n"
                f"whole  : {manifest['source']['name']} sha256 {manifest['source']['sha256']}\n\n"
                "Content is age-encrypted. Collect all parts and the manifest in one folder and run\n"
                "scripts/ops/backup/restore_from_email.sh (docs/ops/BACKUP_EMAIL.md).\n")
        msgs.append(make_message(
            f"[roxira-backup] offsite {manifest['date']} part {p.index:02d}/{p.total:02d}", body, sender, to,
            [(mname, mj), (p.name, Path(p.path).read_bytes())]))
    return msgs


# ---------------------------------------------------------------- CLI
def _smtp_env(offsite: bool = False):
    user = os.environ.get("BACKUP_SMTP_USER", "")
    raw = os.environ.get("BACKUP_SMTP_PASS", "")
    pw = "".join(raw.split())
    # Offsite parts are a backup channel, not notifications: BACKUP_OFFSITE_TO can point them at a
    # different mailbox than the owner's inbox (BACKUP_NOTIFY_TO).
    to = (os.environ.get("BACKUP_OFFSITE_TO", "") if offsite else "") or os.environ.get("BACKUP_NOTIFY_TO", "")
    host = os.environ.get("BACKUP_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("BACKUP_SMTP_PORT", "587"))
    return user, pw, to, host, port, os.environ.get("BACKUP_NOTIFY_FROM", user)


def _notify_module():
    """scripts/ops/notify/notify.py (digest queue + urgent Telegram); None when unavailable."""
    try:
        import importlib.util
        path = Path(__file__).resolve().parents[1] / "notify" / "notify.py"
        spec = importlib.util.spec_from_file_location("notify", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    except Exception:  # noqa: BLE001 - notification must never break a backup
        return None


def _deliver(msgs, dry_run: bool, offsite: bool = False) -> int:
    user, pw, to, host, port, _ = _smtp_env(offsite)
    if dry_run:
        for m in msgs:
            print(f"[dry-run] would send via {host}:{port} to={to or '<unset>'} subject={m['Subject']!r} "
                  f"bytes={len(m.as_bytes())}")
        return 0
    missing = [n for n, v in (("BACKUP_SMTP_USER", user), ("BACKUP_SMTP_PASS", pw), ("BACKUP_NOTIFY_TO", to)) if not v]
    if missing:
        print("email_offsite: not configured, missing " + ", ".join(missing), file=sys.stderr)
        return 3
    pause = float(os.environ.get("BACKUP_EMAIL_PAUSE_S", "3"))
    try:
        n = send_messages(msgs, lambda: smtplib.SMTP(host, port, timeout=120), user, pw, pause)
    except smtplib.SMTPAuthenticationError as exc:
        print(f"email_offsite: SMTP authentication failed (code {exc.smtp_code})", file=sys.stderr)
        return 4
    print(f"email_offsite: sent {n} message(s) to {to}")
    return 0


def cmd_report(a) -> int:
    caps = Caps.from_env()
    date = a.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    status = {}
    for f in (a.status_env, a.check_env, a.r2_env, a.drill_env):
        if f and Path(f).is_file():
            status.update(parse_status_env(Path(f).read_text(errors="replace")))
    sets = scan_sets(Path(a.sets_dir), int(a.hash_max_mb * MB)) if a.sets_dir else []
    off = json.loads(Path(a.offsite_manifest).read_text()) if a.offsite_manifest and Path(a.offsite_manifest).is_file() else None
    fresh = freshness(sets, status, datetime.now(timezone.utc),
                      float(os.environ.get("BACKUP_MAX_SET_AGE_H", "30")),
                      float(os.environ.get("BACKUP_MAX_R2_AGE_H", "3")),
                      float(os.environ.get("BACKUP_MAX_DRILL_AGE_H", "192")),
                      a.expect_r2, a.expect_drill)
    m = build_report_manifest(date, a.host or os.uname().nodename, status, sets, a.disk_pct, caps, off, fresh)
    md = render_report_md(m)
    if a.out_dir:
        Path(a.out_dir).mkdir(parents=True, exist_ok=True)
        (Path(a.out_dir) / f"backup-report-{date}.md").write_text(md, encoding="utf-8")
        (Path(a.out_dir) / f"manifest-{date}.json").write_text(json.dumps(m, indent=2), encoding="utf-8")
    ok = m["status"] == "OK"
    subject = f"[roxira-backup] daily report: {'OK' if ok else 'ATTENTION ' + m['status']}"
    body = md.partition("## Local sets")[0]
    extra = [(Path(p).name, Path(p).read_bytes()) for p in a.attach]
    sender = _smtp_env()[5] or "unset@example.invalid"
    if not extra:
        # Daily report: no mail of its own. A short summary + the file path go to the digest;
        # a failing backup also sends one Telegram message (1/h per problem).
        path = str(Path(a.out_dir) / f"backup-report-{date}.md") if a.out_dir else ""
        if a.dry_run:
            print(f"[dry-run] would queue for the digest: {subject} file={path}")
            return 0
        mod = _notify_module()
        if mod:
            mod.enqueue_report("backup", subject, body, path)
            if not ok:
                mod.urgent("backup:report", f"{subject}. Details: {path}")
        return 0
    # Weekly config bundle attached: this IS the offsite copy, so it is mailed (once a week).
    msg = make_message(subject, body, sender, _smtp_env(True)[2] or "unset@example.invalid",
                       [(f"backup-report-{date}.md", md.encode()),
                        (f"manifest-{date}.json", json.dumps(m, indent=2).encode())] + extra)
    return _deliver([msg], a.dry_run, offsite=True)


def cmd_offsite(a) -> int:
    caps = Caps.from_env()
    date = a.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    host = a.host or os.uname().nodename
    state_path = Path(a.state_file)
    state = read_day_state(state_path, date)
    work = Path(a.work_dir)
    try:
        manifest, parts = plan_offsite(Path(a.input), work, date, host, caps, state["bytes"])
    except OffsiteError as exc:
        print(f"email_offsite: {exc}", file=sys.stderr)
        return 2
    sender = _smtp_env()[5] or "unset@example.invalid"
    to = _smtp_env(True)[2] or "unset@example.invalid"
    (work / f"offsite-manifest-{date}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if manifest["status"] != "OK":
        print("email_offsite: " + manifest["note"], file=sys.stderr)
        note = make_message(f"[roxira-backup] offsite {date}: NOT SENT (over cap)", manifest["note"] + "\n", sender, to,
                            [(f"offsite-manifest-{date}.json", json.dumps(manifest, indent=2).encode())])
        mod = _notify_module()
        if mod and not a.dry_run:
            mod.enqueue_report("backup", f"offsite {date}: NOT SENT (over cap)", manifest["note"])
        return 5
    if state["mails"] > 0 and not a.dry_run and not os.environ.get("BACKUP_OFFSITE_TO"):
        # Same mailbox as the owner's inbox: at most one offsite run per day.
        print("email_offsite: offsite already mailed today; skipping (set BACKUP_OFFSITE_TO for a separate mailbox)")
        return 0
    msgs = offsite_messages(manifest, parts, sender, to)
    rc = _deliver(msgs, a.dry_run, offsite=True)
    if rc == 0 and not a.dry_run:
        state["bytes"] += sum(p.size for p in parts)
        state["mails"] += len(parts)
        write_day_state(state_path, state)
    if not a.keep_work:
        for p in parts:
            Path(p.path).unlink(missing_ok=True)
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("report")
    r.add_argument("--status-env"); r.add_argument("--check-env"); r.add_argument("--sets-dir")
    r.add_argument("--out-dir"); r.add_argument("--date"); r.add_argument("--host")
    r.add_argument("--disk-pct", type=int); r.add_argument("--hash-max-mb", type=float, default=512)
    r.add_argument("--expect-r2", action="store_true"); r.add_argument("--expect-drill", action="store_true")
    r.add_argument("--r2-env"); r.add_argument("--drill-env")
    r.add_argument("--offsite-manifest"); r.add_argument("--attach", action="append", default=[])
    r.add_argument("--dry-run", action="store_true")
    o = sub.add_parser("offsite")
    o.add_argument("--input", required=True, help="age-encrypted file to split and mail")
    o.add_argument("--work-dir", required=True)
    o.add_argument("--state-file", default="/var/lib/roxira-backup/email_day.json")
    o.add_argument("--date"); o.add_argument("--host")
    o.add_argument("--keep-work", action="store_true"); o.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    return cmd_report(a) if a.cmd == "report" else cmd_offsite(a)


if __name__ == "__main__":
    sys.exit(main())
