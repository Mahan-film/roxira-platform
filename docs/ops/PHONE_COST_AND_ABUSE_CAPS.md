# Phone Cost Caps & Abuse Prevention Runbook (T298 / R30)

## 1. Overview & Context

This runbook documents the telephony cost accounting, abuse mitigation limits, and budget alerting implemented under **T298 (R30)**.
Telephony operations expose services to telephony toll fraud, runaway streaming sessions, and carrier minute rounding overhead. To prevent financial waste and denial-of-wallet attacks, the platform enforces strict effective-dated pricing models, daily per-number caps, global circuit breakers, and automated monthly spend alerts.

Primary sources:
- `docs/strategy/research/R30_DIGEST.md` (Stage 1 telephony architecture and compliance blueprint)
- `docs/strategy/research/R30_GEMINI.md` (Second opinion fact check and vendor rate sheets)

---

## 2. Configuration & Effective-Dated Pricing

All statutory figures, carrier rates, and platform fees are governed by `config/phone_pricing.json`.
In accordance with Roxira Autonomous Engineering Standards, **no price or statutory rate is hardcoded in application logic**. Every rate carries primary verification metadata (`verified: true|false`, `source`, and `notes`).

### Pricing Schema & Rate Breakdown

```json
{
  "effective_dates": {
    "valid_from": "2026-11-01T00:00:00Z",
    "valid_to": "2027-12-31T23:59:59Z"
  },
  "platform_plans": {
    "livekit_cloud_scale": {
      "monthly_fee_usd_cents": 50000,
      "agent_minute_usd_cents": 1.0,
      "observability_minute_usd_cents": 1.0,
      "minimum_duration_seconds": 10,
      "verified": false,
      "source": "R30 Second Opinion PR #1221; LiveKit Cloud Scale plan"
    }
  },
  "carriers": {
    "telnyx": {
      "inbound_per_minute_usd_cents": 0.32,
      "billing_increment_seconds": 60,
      "minimum_duration_seconds": 60,
      "verified": false
    },
    "twilio": {
      "inbound_per_minute_usd_cents": 0.60,
      "billing_increment_seconds": 60,
      "minimum_duration_seconds": 60,
      "verified": true
    },
    "easybell": {
      "inbound_per_minute_usd_cents": 0.0,
      "outbound_landline_per_minute_usd_cents": 0.73,
      "billing_increment_seconds": 1,
      "verified": true
    }
  }
}
```

### Carrier Billing Increments & Rounding Rules

1. **Carrier 60/60 Rounding**:
   - Telnyx, Twilio Elastic SIP, and sipgate trunking round partial minutes up to the next full 60-second boundary.
   - Example: A 12-second call is billed for 60 seconds (1 minute). A 61-second call is billed for 120 seconds (2 minutes).
   - $\text{CarrierBillable} = \max(\text{min\_duration}, \lceil \text{duration} / 60 \rceil \times 60)$.

2. **Per-Second (1/1) Billing**:
   - easybell Volume trunks bill in exact 1-second increments ($1/1$ billing), preventing hangup rounding waste.

3. **LiveKit Cloud 10s Minimum Duration**:
   - LiveKit Scale plan charges a 10-second minimum per agent session.
   - $\text{LiveKitBillable} = \max(10, \text{duration})$.

---

## 3. Abuse Caps & Circuit Breakers

| Cap Level | Metric | Default Threshold | Action on Breach |
|---|---|---|---|
| **Per-Caller Daily** | Max Calls | 5 calls / 24 hours | Call rejected with refusal log & busy prompt |
| **Per-Caller Daily** | Max Duration | 1,800s (30 min) connected audio / 24 hours | Call rejected with refusal log & busy prompt |
| **Global Daily** | Max Calls | 200 calls / day across all callers | Global circuit breaker tripped; calls refused |
| **Global Daily** | Max Duration | 36,000s (10 hours) connected audio / day | Global circuit breaker tripped; calls refused |
| **Monthly Spend Cap** | Monthly Total | USD 1,000.00 (100,000 cents) | All inbound calls rejected with busy prompt |
| **Monthly Alert** | Warning Ratio | 80% (USD 800.00 / 80,000 cents) | Status page check fails; automated alert triggered |

---

## 4. State Persistence & Observability

- **State File**: `/srv/data/phone/state/phone_usage_state.json` (fallback to `services/voice_phone_agent/cache/phone_usage_state.json`).
- **Atomic Writes**: Updated via temp file write and rename (`fs.renameSync`) to ensure crash consistency.
- **Monthly Roll**: Counters roll over automatically on the 1st of each calendar month UTC.
- **Monitoring Integration**:
  - `phone:monthly-spend-cap`: Asserts monthly total < 100% of cap.
  - `phone:spend-alert-80`: Asserts monthly total < 80% of cap (fails warning check at 80%).
  - `phone:daily-caps`: Asserts global daily calls and duration within limits.

---

## 5. Diagnostic & Operational Commands

```bash
# 1. Audit current spend, limits, and cap status
sudo phone-stack costs

# 2. Run automated check (exits 0 if healthy, 1 on 80% alert, 2 on 100% cap breach)
sudo phone-stack costs --check

# 3. Simulate call duration to verify carrier rounding and cost models
sudo phone-stack costs --simulate-call 125 --carrier telnyx --plan livekit_cloud_scale

# 4. View phone stack health summary (including cost caps)
sudo phone-stack status

# 5. Offline Python CLI auditor directly:
python3 scripts/ops/ci_box/check_phone_costs.py --report
```
