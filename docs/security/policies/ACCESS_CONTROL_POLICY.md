# Roxira Access Control Policy

> **Policy Reference**: POL-SEC-001  
> **Effective Date**: 2026-11-22  
> **Status**: Active Standard  
> **Master Reference**: Task T289 (#1112)

---

## 1. Purpose & Scope
This policy establishes access control requirements across the Roxira platform, infrastructure, and administrative boundaries. It applies to all systems, databases, APIs, employees, and automated services processing customer or organizational data.

## 2. Core Principles
1. **Principle of Least Privilege (PoLP)**: Access is granted strictly on a need-to-know, need-to-do basis. Default state is deny-all (fail-closed).
2. **Role-Based Access Control (RBAC)**: Fine-grained permissions are assigned to predefined functional roles (`ADMIN`, `FINANCE`, `SALES`, `WAREHOUSE`, `ADVISOR`, `VIEWER`), validated via `AccessGuard` and `permission-matrix.snapshot.json`.
3. **Multi-Factor Authentication (MFA)**:
   - Mandatory for all administrative and operational staff.
   - Enforced via FIDO2 / WebAuthn Passkeys (`auth_passkey_credentials`) and RFC 6238 TOTP (`user_totp`).
4. **Just-In-Time (JIT) & Ephemeral Access**: Infrastructure-level production access requires time-bound JIT authorization, dual-approval, and session recording.

## 3. Account Lifecycle Management
- **Onboarding**: Automated provisioning via tenant invitation workflow (`tenant_invitations`). Account creation requires verified email or authenticated mobile phone number.
- **Offboarding**: Immediate session termination across all active tokens upon employment conclusion or role revocation via `revoke_refresh_token_family`.
- **Credential Constraints**:
   - Password hashing strictly uses Argon2id or bcrypt (cost factor $\ge 12$).
   - Direct database access prohibits shared accounts; all services authenticate using distinct unprivileged service roles (`roxira_app`).

## 4. Review & Auditing
- Access rights and tenant memberships are subject to automated quarterly access reviews.
- 12 months of audit log is our retention for all authentication, authorization, and permission mutation events.
