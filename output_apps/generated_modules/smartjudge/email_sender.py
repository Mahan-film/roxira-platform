"""Transactional e-mail for Smart Judge accounts (stdlib smtplib, no extra dependency).

Configuration comes from the environment only (never hardcoded):

  SMTP_HOST      e.g. smtp-relay.brevo.com
  SMTP_PORT      default 587 (STARTTLS)
  SMTP_USER      SMTP login; leave empty for the self-hosted relay (no login, no STARTTLS)
  SMTP_PASSWORD  SMTP key / password
  SMTP_STARTTLS  optional 1/0 override (default: on only when SMTP_USER is set)
  SMTP_FROM      e.g. "قاضی هوشمند <no-reply@ghazihoushmand.ir>"

When SMTP_HOST or SMTP_FROM is missing, :func:`is_configured` is False and the e-mail
sign-in endpoints answer 503 (the UI then hides the e-mail tab).  See docs/ops/EMAIL_SETUP.md.
"""
from __future__ import annotations

import asyncio
import html
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr, parseaddr

SITE_URL = "https://ghazihoushmand.ir"
_TIMEOUT_SECONDS = 10


def _cfg(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def is_configured() -> bool:
    return bool(_cfg("SMTP_HOST") and _cfg("SMTP_FROM"))


def _port() -> int:
    try:
        return int(_cfg("SMTP_PORT", "587"))
    except ValueError:
        return 587


def _use_starttls() -> bool:
    """STARTTLS when logging in (default); plain when SMTP_USER is empty, i.e. the self-hosted relay on the
    private docker network (roxira_mail:25). SMTP_STARTTLS=1/0 overrides either way."""
    override = _cfg("SMTP_STARTTLS").lower()
    if override in ("1", "true", "yes"):
        return True
    if override in ("0", "false", "no"):
        return False
    return bool(_cfg("SMTP_USER"))


def _header_safe(value: str) -> str | None:
    """The value when it is safe in one header line, else None (CR/LF/NUL would allow header injection)."""
    if any(ch in value for ch in ("\r", "\n", "\x00")):
        return None
    return value


def send_email(to: str, subject: str, text: str, html_body: str) -> bool:
    """Send one multipart message. Never raises; returns False on any failure.

    The recipient address and body are never logged (only the exception class).
    """
    if not is_configured():
        return False
    # Explicit guard (EmailMessage also refuses CR/LF): a recipient must be one plain address.
    to_addr = parseaddr(to)[1]
    if _header_safe(to) is None or _header_safe(subject) is None or not to_addr or to_addr != to.strip():
        print("[AUTH][EMAIL-ERROR] rejected unsafe recipient or subject", file=sys.stderr)
        return False
    try:
        name, addr = parseaddr(_cfg("SMTP_FROM"))
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = formataddr((name, addr)) if addr else _cfg("SMTP_FROM")
        msg["To"] = to
        msg.set_content(text)
        msg.add_alternative(html_body, subtype="html")
        port = _port()
        context = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(_cfg("SMTP_HOST"), port, timeout=_TIMEOUT_SECONDS, context=context) as smtp:
                _login_and_send(smtp, msg)
        else:
            with smtplib.SMTP(_cfg("SMTP_HOST"), port, timeout=_TIMEOUT_SECONDS) as smtp:
                if _use_starttls():
                    smtp.starttls(context=context)
                _login_and_send(smtp, msg)
        return True
    except Exception as exc:  # noqa: BLE001 - delivery problems must never become a 500
        print(f"[AUTH][EMAIL-ERROR] {type(exc).__name__}", file=sys.stderr)
        return False


def _login_and_send(smtp: smtplib.SMTP, msg: EmailMessage) -> None:
    user, password = _cfg("SMTP_USER"), os.environ.get("SMTP_PASSWORD", "")
    if user:
        smtp.login(user, password)
    smtp.send_message(msg)


async def send_email_async(to: str, subject: str, text: str, html_body: str) -> bool:
    return await asyncio.to_thread(send_email, to, subject, text, html_body)


# ---------------------------------------------------------------------------
# Templates (Persian first, English below; the link is the only dynamic part)
# ---------------------------------------------------------------------------
def _wrap(title_fa: str, body_fa: str, title_en: str, body_en: str, url: str, button_fa: str) -> tuple[str, str]:
    safe_url = html.escape(url, quote=True)
    page = f"""<!doctype html>
<html lang="fa" dir="rtl"><body style="margin:0;background:#05080f;font-family:Tahoma,Arial,sans-serif;color:#e2e8f0">
<div style="max-width:520px;margin:0 auto;padding:24px">
<h2 style="color:#fbbf24;margin:0 0 12px">{html.escape(title_fa)}</h2>
<p style="line-height:1.9">{html.escape(body_fa)}</p>
<p style="text-align:center;margin:24px 0"><a href="{safe_url}" style="background:#fbbf24;color:#05080f;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:10px;display:inline-block">{html.escape(button_fa)}</a></p>
<p style="font-size:12px;color:#94a3b8;word-break:break-all">اگر دکمه کار نکرد این نشانی را در مرورگر باز کنید:<br><a href="{safe_url}" style="color:#38bdf8">{safe_url}</a></p>
<hr style="border:0;border-top:1px solid #1e293b;margin:24px 0">
<div dir="ltr" style="text-align:left;font-size:13px;color:#94a3b8"><b>{html.escape(title_en)}</b><br>{html.escape(body_en)}</div>
</div></body></html>"""
    text = f"{title_fa}\n\n{body_fa}\n\n{url}\n\n--\n{title_en}\n{body_en}\n{url}\n"
    return text, page


def verification_email(token: str) -> tuple[str, str, str]:
    url = f"{SITE_URL}/verify-email?token={token}"
    text, page = _wrap(
        "تأیید ایمیل قاضی هوشمند",
        "برای فعال‌سازی حساب خود روی دکمهٔ زیر بزنید. این پیوند ۲۴ ساعت اعتبار دارد و فقط یک بار قابل استفاده است. "
        "اگر شما ثبت‌نام نکرده‌اید این پیام را نادیده بگیرید.",
        "Verify your email - Ghazi Houshmand",
        "Open the link to activate your account. It expires in 24 hours and works once. "
        "If you did not sign up, ignore this message.",
        url, "تأیید ایمیل",
    )
    return "تأیید ایمیل - قاضی هوشمند", text, page


def reset_email(token: str) -> tuple[str, str, str]:
    url = f"{SITE_URL}/reset-password?token={token}"
    text, page = _wrap(
        "بازیابی رمز عبور",
        "برای تعیین رمز عبور جدید روی دکمهٔ زیر بزنید. این پیوند ۱ ساعت اعتبار دارد و فقط یک بار قابل استفاده است. "
        "اگر شما درخواست نکرده‌اید این پیام را نادیده بگیرید؛ رمز شما تغییری نمی‌کند.",
        "Reset your password - Ghazi Houshmand",
        "Open the link to choose a new password. It expires in 1 hour and works once. "
        "If you did not ask for this, ignore it; your password stays unchanged.",
        url, "تعیین رمز جدید",
    )
    return "بازیابی رمز عبور - قاضی هوشمند", text, page


def already_registered_email() -> tuple[str, str, str]:
    url = SITE_URL
    text, page = _wrap(
        "این ایمیل قبلاً ثبت‌نام شده است",
        "کسی با این ایمیل ثبت‌نام کرد، اما حساب فعالی با این نشانی وجود دارد. اگر خودتان بودید وارد شوید "
        "یا در صورت فراموشی رمز، از گزینهٔ «فراموشی رمز» استفاده کنید.",
        "This email is already registered",
        "Someone tried to sign up with this address, but an account already exists. "
        "Sign in, or use 'forgot password' if needed.",
        url, "ورود / بازیابی رمز",
    )
    return "حساب شما از قبل وجود دارد - قاضی هوشمند", text, page
