"""Iranian standard chart of accounts seed (کدینگ استاندارد حسابداری)."""

from __future__ import annotations

import sys

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models.accounts import Account

#: (code, title, type, balance) — Iranian accounting standard coding.
IRANIAN_CHART_OF_ACCOUNTS: tuple[tuple[str, str, str, float], ...] = (
    ('1101', 'موجودی نقد و صندوق', 'ASSET', 0.0),
    ('1102', 'بانک\u200cها', 'ASSET', 0.0),
    ('1103', 'تنخواه\u200cگردان', 'ASSET', 0.0),
    ('1104', 'حساب\u200cهای دریافتنی تجاری', 'ASSET', 0.0),
    ('1105', 'موجودی مواد و کالا', 'ASSET', 0.0),
    ('1106', 'پیش\u200cپرداخت\u200cها', 'ASSET', 0.0),
    ('1201', 'دارایی\u200cهای ثابت مشهود', 'ASSET', 0.0),
    ('1202', 'استهلاک انباشته دارایی\u200cهای ثابت', 'ASSET', 0.0),
    ('2101', 'حساب\u200cهای پرداختنی تجاری', 'LIABILITY', 0.0),
    ('2102', 'مالیات پرداختنی', 'LIABILITY', 0.0),
    ('2103', 'بیمه پرداختنی', 'LIABILITY', 0.0),
    ('2104', 'حقوق و دستمزد پرداختنی', 'LIABILITY', 0.0),
    ('2201', 'وام\u200cهای بلندمدت', 'LIABILITY', 0.0),
    ('3101', 'سرمایه', 'EQUITY', 0.0),
    ('3102', 'سود و زیان انباشته', 'EQUITY', 0.0),
    ('4101', 'درآمد فروش کالا', 'INCOME', 0.0),
    ('4102', 'درآمد ارائه خدمات', 'INCOME', 0.0),
    ('4103', 'برگشت از فروش', 'INCOME', 0.0),
    ('5101', 'بهای تمام\u200cشده کالای فروش رفته', 'EXPENSE', 0.0),
    ('5102', 'هزینه حقوق و دستمزد', 'EXPENSE', 0.0),
    ('5103', 'هزینه اجاره', 'EXPENSE', 0.0),
    ('5104', 'هزینه استهلاک', 'EXPENSE', 0.0),
    ('5105', 'هزینه آب، برق و گاز', 'EXPENSE', 0.0),
    ('5106', 'سایر هزینه\u200cهای عمومی و اداری', 'EXPENSE', 0.0),
)


async def seed_chart_of_accounts() -> int:
    """Insert the standard chart once; a populated ledger is left alone."""
    async with SessionLocal() as session:
        existing = await session.scalar(select(func.count()).select_from(Account))
        if existing:
            return 0
        session.add_all(
            [
                Account(code=code, title=title, type=entry_type, balance=balance)
                for code, title, entry_type, balance in IRANIAN_CHART_OF_ACCOUNTS
            ]
        )
        await session.commit()
        return len(IRANIAN_CHART_OF_ACCOUNTS)


async def seed_database() -> int:
    """Best-effort startup seed: never block the portal from booting."""
    try:
        return await seed_chart_of_accounts()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[seed] chart of accounts skipped: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 0
