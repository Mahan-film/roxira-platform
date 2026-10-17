# Crypto payments (USDT on TRON / TRC20) — optional, OFF by default

> **Owner decision needed before enabling**
> 1. **Legal / sanctions status.** Confirm whether this business may accept crypto payments
>    (Iranian rules on crypto as a payment instrument, any licensing/reporting duty, and the
>    compliance rules of the exchanges the funds will pass through). Until the owner confirms in
>    writing, `CRYPTO_PAY_ENABLED` stays `0`: with it off no endpoint, table change or UI exists.
> 2. **Wallet security.** Use a dedicated receive-only wallet. Keep its private key/seed offline
>    (hardware wallet or paper). It must never be on the server, in this repo or in any env file;
>    the server only knows the public address.

## What it is

Self-custody checkout for users abroad: no payment processor, no KYC provider, no fees beyond the
TRON network fee the payer pays. The user sends USDT (TRC20) to our public address; we match the
on-chain transfer by exact amount and activate the plan through the same path as Zibal.

## How it works

1. Logged-in user clicks «پرداخت با تتر (USDT - TRC20)» on a subscription plan (the one-off
   `SINGLE_DRAFT` has no USD price, so it is Zibal-only).
2. `POST /api/v1/apps/judge/payments/crypto/create-invoice` `{plan_type}` creates a row in
   `payment_orders` with `method='usdt_trc20'`, `amount_usdt` (string, 6 dp) = plan USD base price
   (`pricing_service`, never the toman price, never client input) + a unique micro suffix
   (`+0.000001 … +0.009999`, unique among open invoices via a partial unique index), `address`,
   `expires_at` = now + 60 min and `tx_hash` (filled on payment). `track_id` is `USDT_<32 hex>`.
3. `scripts/ops/crypto/poll_usdt.py` (systemd timer, every minute) and
   `GET .../payments/crypto/status/{track_id}` (the UI polls every 15 s) call
   `crypto_payment_service.poll_once`: TronGrid
   `GET /v1/accounts/{addr}/transactions/trc20?only_confirmed=true&contract_address=<USDT>&min_timestamp=...`.
4. A transfer settles an invoice only if: contract is official USDT, `to` is our address, `value`
   equals the invoice amount exactly, block time is inside `[created_at, expires_at]`, and the
   `tx_hash` was never used (unique index). Then `mark_paid` (atomic) + the shared
   `payment_service.activate_with_retry` run. Re-polling is idempotent.
5. Anything else that reaches our address with >= 1 USDT (under/overpayment, late, wrong amount)
   is **not** activated; it is stored in `crypto_unmatched_tx` (and logged as WARNING) for support.
   Review with `SELECT * FROM crypto_unmatched_tx WHERE NOT resolved;` and refund/grant manually.
6. Paid -> the UI goes to `/judge/payment/callback?trackId=USDT_…`, which calls the normal
   `/payments/verify`; for `USDT_` ids that endpoint reads the crypto order (no Zibal call).

Key files: `output_apps/ecosystem_core/src/billing/crypto_payment_service.py` (logic),
`crypto_orders.py` (Postgres), `router_crypto.py` (HTTP), `scripts/ops/crypto/` (poller + units),
`.../frontend/src/components/judge/subscription/crypto-pay-panel.tsx`. Tests:
`src/billing/test_crypto_payment_service.py`, `src/billing/test_router_crypto.py`.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `CRYPTO_PAY_ENABLED` | no (default `0`) | `1` turns the feature on. Off => endpoints 404, UI hidden, schema untouched |
| `CRYPTO_USDT_TRC20_ADDRESS` | when enabled | Public TRON receive address (`T…`, base58check-validated at startup of each call; invalid => feature stays off) |
| `TRONGRID_API_KEY` | no | Sent as `TRON-PRO-API-KEY`; raises TronGrid rate limits. Server env only |

Not to be confused with the older, unrelated `PAYMENTS_CRYPTO_ENABLED` flag in `payment_service.py`.

## How to enable (after the owner decision)

1. On a dedicated offline wallet create a TRC20 address; put only the address in the server env file.
2. Set `CRYPTO_PAY_ENABLED=1`, `CRYPTO_USDT_TRC20_ADDRESS=…` (and optionally `TRONGRID_API_KEY`);
   restart the Smart Judge API (owner approval needed; do not restart prod from an agent).
3. `sudo cp scripts/ops/crypto/roxira-usdt-poll.{service,timer} /etc/systemd/system/ &&
   sudo systemctl daemon-reload && sudo systemctl enable --now roxira-usdt-poll.timer`.
4. Test with a small real payment on a test plan price (`PRICE_USD_<PLAN_KEY>` override) first.
   The first call with the flag on adds columns/indexes to `payment_orders` and creates
   `crypto_unmatched_tx` (idempotent `IF NOT EXISTS`, same convention as `payment_orders.py`).

To disable: set `CRYPTO_PAY_ENABLED=0`; open invoices simply stop being polled.

## Risks and limits

- Legal/compliance: see the box at the top. Sanctions exposure on inbound funds is the owner's call.
- Payer mistakes are the main support load: wrong network (ERC20/BEP20 funds sent to a TRON address
  are not seen and may be lost), wrong amount, exchange withdrawals that deduct the fee from the
  amount (the payer must cover the fee so the exact amount arrives), paying after 60 min.
- Address poisoning/dust: transfers < 1 USDT are ignored, not stored.
- TronGrid is a third-party read-only API; outages only delay activation (invoice stays pending,
  grace of 6 h before a pending invoice is swept to `expired`, so late-seen in-window payments
  still match). Rate limits on the free tier: set `TRONGRID_API_KEY` if traffic grows.
- Only confirmed transfers count (`only_confirmed=true`), so a few minutes delay is normal.
- Price is USD-pegged by definition; USDT depegging risk is accepted. No automatic refunds: refunds
  are manual from the offline wallet.
- Capacity: 9,999 distinct amounts per plan price; allocation fails with 503 if all are open.
