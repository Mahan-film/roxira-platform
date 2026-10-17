#!/usr/bin/env python3
"""Poll TronGrid for incoming USDT-TRC20 payments and activate matched invoices.

Run by roxira-usdt-poll.timer (every minute). A silent no-op (exit 0) unless
CRYPTO_PAY_ENABLED=1 and CRYPTO_USDT_TRC20_ADDRESS is set — safe to install
before the owner decides. Idempotent: running twice never activates twice.
Env: CRYPTO_PAY_ENABLED, CRYPTO_USDT_TRC20_ADDRESS, optional TRONGRID_API_KEY,
plus the usual DATABASE_URL / POSTGRES_* of the billing layer. See
docs/ops/CRYPTO_PAYMENTS.md.
"""
from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from output_apps.ecosystem_core.src.billing import (  # noqa: E402
    crypto_orders,
    crypto_payment_service as cps,
    zibal_service,
)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not cps.crypto_pay_enabled():
        print("crypto payments disabled; nothing to do")
        return 0
    conn = crypto_orders.get_connection()
    try:
        summary = cps.poll_once(
            store=crypto_orders.PgCryptoOrderStore(conn),
            activate_fn=zibal_service.activate_user_subscription,
        )
    except Exception:
        logging.exception("usdt poll failed")
        return 1
    finally:
        conn.close()
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
