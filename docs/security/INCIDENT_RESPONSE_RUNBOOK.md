# Incident Response & Breach-Notice Runbook (T291 / R29)

Effective date: `2026-11-21`
Policy config: [`config/data_retention_policy.json`](../../config/data_retention_policy.json)
Security contact: `/.well-known/security.txt`

## 1. Severity Classification

| Severity | Definition | Initial Triage | Customer Notice Target |
|---|---|---|---|
| **SEV-1 (Critical)** | Confirmed unauthorized access to tenant data, cross-tenant data leak, credential/key compromise, or ransomware/destructive breach | <= 4 hours | **<= 48 hours** (see `config/data_retention_policy.json`) |
| **SEV-2 (High)** | Active exploitation attempt, high-severity vulnerability with viable exploit path, or prolonged production outage | <= 4 hours | Within 48 hours if personal data impact cannot be ruled out |
| **SEV-3 (Medium)** | Contained security misconfiguration, single-tenant non-PII bug, or non-critical service degradation | <= 1 business day | As needed |
| **SEV-4 (Low)** | Informational finding, scanner noise, or hardening improvement | <= 5 business days | None |

## 2. Incident Response Roles

- **Incident Commander (IC)**: Owns timeline, severity declaration, containment sign-off, and external/customer communications approval.
- **Technical Lead (TL)**: Executes containment, forensic log preservation, key rotation, and remediation patches.
- **Communications Lead (CL)**: Prepares the 48-hour customer breach notice, tracks affected tenant contacts, and coordinates with legal/DPO for supervisory authority notifications (within the 72-hour GDPR Art. 33 window where applicable).

## 3. Response Lifecycle

### Phase 1: Detection & Triage (T+0 to T+4h)
1. Open a private incident ticket and record UTC timestamps for every action.
2. Confirm scope: affected services, tenant IDs, data classes (from `config/data_retention_policy.json`), and whether personal data or secrets were exposed.
3. Declare severity (SEV-1..SEV-4) and assign IC, TL, and CL.

### Phase 2: Containment & Evidence Preservation (T+4h to T+12h)
1. Preserve volatile evidence BEFORE destructive remediation:
   - Export relevant nginx, NestJS, FastAPI, and PostgreSQL audit logs to an immutable evidence directory.
   - Record active container digests and git SHAs.
2. Contain the blast radius:
   - Revoke compromised JWT signing secrets, API keys, or OAuth tokens.
   - Isolate affected service or apply emergency firewall/rate-limit rules.
   - Verify RLS (`roxira_app` role) and tenant isolation invariants.

### Phase 3: Customer Breach Notice (<= T+48h for SEV-1)
Send written notice to affected tenant administrators within **48 hours** of confirming a personal-data breach (inside the 72-hour GDPR Art. 33 supervisory window):

```text
Subject: [Security Notice] Incident <INC-YYYYMMDD-NN> — <Short Summary>

1. Incident Summary & Timeline (UTC):
   - Detected at: <UTC timestamp>
   - Contained at: <UTC timestamp>
2. Scope & Affected Data Classes:
   - Affected tenant(s): <Tenant Name / ID>
   - Data classes involved: <from config/data_retention_policy.json>
3. Actions Taken by Roxira:
   - <Containment, credential rotation, patch deployed>
4. Recommended Customer Actions:
   - <Rotate tenant API keys / review audit log / notify supervisory authority if applicable>
5. Point of Contact:
   - security@roxira.com (reference <INC-YYYYMMDD-NN>)
```

### Phase 4: Recovery & Post-Incident Review (T+5 business days)
1. Deploy permanent fix with regression test covering the root cause.
2. Complete blameless post-incident review within 5 business days and append preventive rules to `docs/agents/LESSONS.md` if applicable.

## 4. Tabletop Drill Log

### Drill #1 — Simulated Tenant API Key Leak (`2026-11-21`)
- **Scenario**: Automated secret scanner alerts that a test tenant's webhook signing key was committed to a public issue comment.
- **Simulated Timeline**:
  - `T+00:00` Alert received; IC declared SEV-2 (escalated to SEV-1 pending audit log check).
  - `T+00:25` Audit logs queried for key usage; confirmed zero unauthorized reads across other tenants (RLS held).
  - `T+00:40` Key revoked and rotated; public comment scrubbed.
  - `T+01:15` Customer notice drafted using the Section 3 template (well inside the 48h SLA).
- **Findings / Follow-ups**:
  - Verified `/.well-known/security.txt` is published for external reporters.
  - Verified retention windows and disposal methods are centralized in `config/data_retention_policy.json`.
