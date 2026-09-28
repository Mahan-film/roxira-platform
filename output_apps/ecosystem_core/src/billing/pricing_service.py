#!/usr/bin/env python3
"""Fixed Toman pricing for Smart Judge plans (W22).

Deliberately framework- and network-free (like payment_service.py) so it can
be unit tested offline: reads only ``os.environ`` and returns a plain dict —
no FastAPI, no database, no HTTP. output_apps/generated_modules/smartjudge/
smartjudge_module.py wires ``get_calculated_pricing()`` into the
``/payments/pricing-matrix`` endpoint and into ``create_payment_invoice``
(via output_apps.ecosystem_core.src.billing.payment_service.create_invoice),
which is the only place an amount is ever charged.

Each plan has a fixed Toman price the owner controls directly in
``BASE_PLANS_TOMAN``, no longer pegged to a USD/Toman exchange rate. Every
plan's price is overridable at deploy time via the environment variable
``PRICE_TOMAN_<PLAN_KEY>`` (a positive integer number of Toman), e.g.::

    PRICE_TOMAN_SINGLE_DRAFT=120000
"""
from __future__ import annotations

import os

# Code defaults, used whenever the matching PRICE_TOMAN_<KEY> environment
# variable is unset, blank or invalid.
BASE_PLANS_TOMAN: dict[str, dict[str, object]] = {
    "SINGLE_DRAFT": {
        "name": "خرید لایحه تکی تخصصی دادگاه",
        "default_toman": 100_000,
    },
    "VOICE_PACK_10MIN": {
        "name": "بسته ۱۰ دقیقه مشاوره صوتی زنده",
        "default_toman": 63_000,
    },
    "VIP_MONTHLY_PRO": {
        "name": "اشتراک ماهانه نامحدود VIP وکلا و مراجعین",
        "default_toman": 490_000,
    },
    "DIASPORA_SPECIAL": {
        "name": "بسته تخصصی امور حقوقی خارج از کشور (املاک/ارث)",
        "default_toman": 1_015_000,
    },
}


def env_plan_price_toman(plan_key: str, default_toman: int) -> int:
    """Reads ``PRICE_TOMAN_<plan_key>`` from the environment; falls back to
    ``default_toman`` when the variable is unset, blank, non-numeric or not a
    positive integer. This is the only place a plan's Toman price is decided
    server-side — a client-supplied amount is never read."""
    raw = os.environ.get(f"PRICE_TOMAN_{plan_key}")
    if raw is None or not raw.strip():
        return default_toman
    try:
        value = int(raw.strip())
    except ValueError:
        return default_toman
    return value if value > 0 else default_toman


def get_calculated_pricing() -> dict[str, dict[str, object]]:
    """Fixed price per plan, in Toman and Rial (1 Toman = 10 Rial). No
    exchange rate involved."""
    plans: dict[str, dict[str, object]] = {}
    for key, item in BASE_PLANS_TOMAN.items():
        price_toman = env_plan_price_toman(key, int(item["default_toman"]))
        plans[key] = {
            "name": item["name"],
            "price_toman": price_toman,
            "price_rial": price_toman * 10,
        }
    return plans
