# Roxira Incident Management Policy

> **Policy Reference**: POL-SEC-004  
> **Effective Date**: 2026-11-22  
> **Status**: Active Standard  
> **Master Reference**: Task T289 (#1112)

---

## 1. Purpose & Scope
This policy establishes standard operating procedures for detecting, triaging, containing, mitigating, and documenting security incidents and potential data breaches across Roxira services.

## 2. Incident Classification & Severity
- **SEV-1 (Critical)**: Active breach or confirmed unauthorized exposure of customer tenant data, critical service outage impacting multiple tenants, or compromised infrastructure root keys.
- **SEV-2 (High)**: Severe vulnerability actively exploitable, partial single-tenant disruption, or confirmed failure of tenant isolation controls.
- **SEV-3 (Medium)**: Localized security flaw, unauthorized attempts blocked by defense-in-depth controls, or transient monitoring anomalies.
- **SEV-4 (Low)**: Minor policy violations, spam/bot scanning activity, or non-exploitable security observations.

## 3. Incident Lifecycle & Customer Notification
1. **Detection & Triage**: Automated alerting via Prometheus, Sentry error capture (`ops_errors`), and telemetry triggers on-call incident response immediately upon SEV-1/SEV-2 classification.
2. **Containment & Isolation**: Application gateways, database connections, or compromised API tokens are revocable within minutes via automated circuit breakers and token family revocation.
3. **Breach Notification Commitment**:
   - In the event of a confirmed personal data breach or unauthorized access to customer data, Roxira notifies impacted customer organizations within **48 hours** of confirmation, exceeding GDPR Article 33/34 timelines.
   - Initial notice provides nature of incident, affected data categories, containment actions taken, and recommended mitigations.
4. **Post-Mortem & Remediation**:
   - A blameless root-cause analysis (RCA) is conducted within 5 business days of incident closure.
   - Corrective actions are assigned with blocking tracking issues.
   - 12 months of audit log is our retention for all incident logs, forensics artifacts, and RCA records.
