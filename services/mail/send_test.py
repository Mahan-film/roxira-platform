#!/usr/bin/env python3
"""Send one test e-mail through the relay and print the result.

Usage (from the server, inside the app network so the name roxira_mail resolves):
  docker exec -i -e SMTP_HOST=roxira_mail -e SMTP_PORT=25 \
      -e SMTP_FROM='no-reply@ghazihoushmand.ir' roxira_app_prod \
      python3 - you@example.com < services/mail/send_test.py

Uses the same SMTP_* variables as the app (smartjudge/email_sender.py). Defaults: roxira_mail:25, no login.
"""
from __future__ import annotations

import os
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr


def main(argv: list[str]) -> int:
    if len(argv) != 2 or "@" not in argv[1]:
        print("usage: send_test.py <recipient@example.com>", file=sys.stderr)
        return 2
    host = os.environ.get("SMTP_HOST", "roxira_mail")
    port = int(os.environ.get("SMTP_PORT", "25") or "25")
    sender = os.environ.get("SMTP_FROM", "no-reply@ghazihoushmand.ir")
    user = os.environ.get("SMTP_USER", "")
    msg = EmailMessage()
    msg["Subject"] = "Roxira mail relay test"
    msg["From"] = sender
    msg["To"] = argv[1]
    msg["Date"] = formatdate(localtime=False)
    domain = parseaddr(sender)[1].rpartition("@")[2] or "ghazihoushmand.ir"
    msg["Message-ID"] = make_msgid(domain=domain)
    msg.set_content("This is a test message from the self-hosted Roxira relay.\nIf you can read it, SMTP works.\n")
    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if user:
                smtp.starttls()
                smtp.login(user, os.environ.get("SMTP_PASSWORD", ""))
            refused = smtp.send_message(msg)
    except Exception as exc:  # noqa: BLE001
        print(f"FAILED via {host}:{port}: {type(exc).__name__}: {exc}")
        return 1
    if refused:
        print(f"FAILED: recipient refused: {refused}")
        return 1
    print(f"OK: accepted by {host}:{port} for {argv[1]} (queued; check inbox, spam, and 'docker logs roxira_mail')")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
