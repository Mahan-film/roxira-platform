#!/usr/bin/env python3
"""Send a short backup status/alert email over SMTP (Gmail App Password) using smtplib.

No third-party service. Credentials come from the environment only:
  BACKUP_SMTP_USER, BACKUP_SMTP_PASS, BACKUP_NOTIFY_TO
  optional: BACKUP_SMTP_HOST (smtp.gmail.com), BACKUP_SMTP_PORT (587), BACKUP_NOTIFY_FROM

Gmail limits to respect (see docs/ops/DISASTER_RECOVERY.md): 25 MB per message including
encoding overhead, ~500 messages/day for a consumer account, App Password needs 2-Step Verification.
Attachments larger than --max-attach-mb (default 20) are refused, never truncated.

  notify_email.py --subject S --body-file F [--attach X ...] [--dry-run]
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from pathlib import Path


def normalize_password(raw: str) -> str:
    """Gmail shows App Passwords as 'abcd efgh ijkl mnop'; the spaces are not part of the secret."""
    return "".join(raw.split())


def build_message(args: argparse.Namespace, sender: str, to: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = args.subject
    msg["From"] = sender
    msg["To"] = to
    msg.set_content(Path(args.body_file).read_text(encoding="utf-8", errors="replace"))
    limit = int(args.max_attach_mb * 1024 * 1024)
    for item in args.attach:
        path = Path(item)
        size = path.stat().st_size
        if size > limit:
            raise SystemExit(f"attachment {path.name} is {size} bytes, over the {args.max_attach_mb} MB limit")
        ctype, _ = mimetypes.guess_type(path.name)
        maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
        msg.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)
    return msg


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-file", required=True)
    parser.add_argument("--attach", action="append", default=[])
    parser.add_argument("--max-attach-mb", type=float, default=20.0)
    parser.add_argument("--dry-run", action="store_true", help="build the message, print a summary, send nothing")
    args = parser.parse_args()

    user = os.environ.get("BACKUP_SMTP_USER", "")
    password = normalize_password(os.environ.get("BACKUP_SMTP_PASS", ""))
    to = os.environ.get("BACKUP_NOTIFY_TO", "")
    host = os.environ.get("BACKUP_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("BACKUP_SMTP_PORT", "587"))
    sender = os.environ.get("BACKUP_NOTIFY_FROM", user)

    if args.dry_run:
        msg = build_message(args, sender or "unset@example.invalid", to or "unset@example.invalid")
        print(f"[dry-run] would send via {host}:{port} to={to or '<BACKUP_NOTIFY_TO unset>'} "
              f"subject={msg['Subject']!r} bytes={len(msg.as_bytes())}")
        return 0

    missing = [n for n, v in (("BACKUP_SMTP_USER", user), ("BACKUP_SMTP_PASS", password), ("BACKUP_NOTIFY_TO", to)) if not v]
    if missing:
        print("notify_email: not configured, missing " + ", ".join(missing), file=sys.stderr)
        return 3

    msg = build_message(args, sender, to)
    try:
        with smtplib.SMTP(host, port, timeout=60) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(user, password)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError as exc:
        print(f"notify_email: SMTP authentication failed (code {exc.smtp_code}). "
              "Check the 16-char App Password and that 2-Step Verification is on.", file=sys.stderr)
        return 4
    print(f"notify_email: sent {msg['Subject']!r} to {to}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
