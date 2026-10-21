"""Single source of truth for what each plan includes (shown on /plans).

Pure read of the constants the enforcing code already uses, so the public page
can never drift from what the server really applies: ``chat_auth`` (chat and
voice hourly limits), ``case_files`` (upload limits) and ``draft_assistant``
(which draft types are VIP only). Nothing here enforces anything.

Tiers: ``guest`` (not logged in), ``free`` (logged in, no VIP), ``vip`` (legacy),
and the paid levels ``basic`` / ``pro`` / ``premium``.
``None`` for a limit means "no per-tier cap is enforced by the server".
"""
from __future__ import annotations

from typing import Any

try:  # package import (production) with a path-independent fallback (tests)
    from . import case_files, chat_auth, draft_assistant
except ImportError:  # pragma: no cover
    from output_apps.generated_modules.smartjudge import case_files, chat_auth, draft_assistant


def get_plan_limits() -> dict[str, Any]:
    vip_only = sorted(draft_assistant.VIP_ONLY_TYPES)
    free_drafts = [t for t in draft_assistant.DRAFT_TYPES if t not in draft_assistant.VIP_ONLY_TYPES]
    return {
        "chat_messages_per_hour": {
            "guest": chat_auth.chat_anon_hourly_limit(),
            # No per-tier hourly chat cap exists in chat_auth (only anonymous chat and voice are limited).
            "free": None,
            "vip": None,
        },
        "chat_messages_per_day": {
            "guest": chat_auth.chat_anon_daily_limit(),
            "free": chat_auth.chat_free_daily_limit(),
            "vip": chat_auth.chat_vip_daily_limit(),
            "basic": chat_auth.chat_basic_daily_limit(),
            "pro": chat_auth.chat_pro_daily_limit(),
            "premium": chat_auth.chat_premium_daily_limit(),
            "team": chat_auth.chat_team_daily_limit(),
        },
        # Answers per day served by the best model group of the level before it steps down
        # (premium: vip-premium then vip-pro; pro: vip-pro then vip-product).
        "top_model_answers_per_day": {
            "pro": chat_auth.pro_top_daily(),
            "premium": chat_auth.premium_top_daily(),
            "team": chat_auth.team_top_daily(),
        },
        "voice_requests_per_hour": {
            "guest": chat_auth.voice_anon_hourly_limit(),
            "free": chat_auth.voice_auth_hourly_limit(),
            "vip": chat_auth.voice_auth_hourly_limit(),
            "basic": chat_auth.voice_auth_hourly_limit(),
            "pro": chat_auth.voice_auth_hourly_limit(),
            "premium": chat_auth.voice_auth_hourly_limit(),
            "team": chat_auth.voice_auth_hourly_limit(),
        },
        "file_uploads_per_day": {
            "guest": 0,  # uploads need a logged-in account
            "free": case_files.DAILY_LIMIT_FREE,
            "vip": case_files.DAILY_LIMIT_VIP,
            "basic": case_files.DAILY_LIMIT_VIP,
            "pro": case_files.DAILY_LIMIT_VIP,
            "premium": case_files.DAILY_LIMIT_VIP,
            "team": case_files.DAILY_LIMIT_VIP,
        },
        "max_file_mb": case_files.MAX_FILE_BYTES // (1024 * 1024),
        "max_pages_per_file": case_files.MAX_PAGES,
        "max_files_per_chat": case_files.MAX_FILES_PER_CHAT,
        "max_message_chars": chat_auth.MAX_CHAT_CHARS,
        "draft_types": {
            "guest": free_drafts,
            "free": free_drafts,
            "vip": list(draft_assistant.DRAFT_TYPES),
            "basic": free_drafts,
            "pro": list(draft_assistant.DRAFT_TYPES),
            "premium": list(draft_assistant.DRAFT_TYPES),
            "team": list(draft_assistant.DRAFT_TYPES),
        },
        "vip_only_draft_types": vip_only,
    }
