# Vulnerability Remediation SLA & Scanner Hardening Policy

This policy defines the security vulnerability remediation service-level agreements (SLA)
and CI scanner enforcement rules for the Roxira Platform codebase, container images, dependencies,
and running services. It establishes the baseline required for enterprise trust and EU compliance
(R29 security baseline).

## 1. Scope & Detection Toolchain

The following automated scanners operate continuously in CI, pre-push hooks, and scheduled runs:

| Scanner | Target | Execution Context | Enforcement |
|---|---|---|---|
| **Gitleaks** | Plaintext keys, tokens, credentials | Pre-push hook & PR CI (`ci.yml`) | **Blocking** (zero tolerance) |
| **Agent Guards** | Money bigint, RLS TenantScope, model registry, plaintext secrets | PR CI (`ci.yml:agent-guards`) | **Blocking** on lines added since merge-base |
| **Semgrep CE** | AST rules (`shell=True`, `NEXT_PUBLIC_*` secrets, NestJS boundaries) | PR CI (`ci.yml:semgrep`) | **Blocking** on new findings since merge-base |
| **Pinned Actions** | GitHub Actions commit SHA pinning and permissions | Pre-push & CI (`scripts/ci/check_pinned_actions.py`) | **Blocking** (all workflows must be pinned to 40-char SHA) |
| **Trivy** | Filesystem, package CVEs, secrets, IaC misconfigurations | PR CI (`ci.yml:trivy-fs`) | Checksum-verified binary (`scripts/dev/install_trivy.sh`), report upload |
| **OSV-Scanner** | Tracked dependency lockfiles (`package-lock.json`, `requirements*.txt`) | PR CI (`ci.yml:osv-scanner`) | Checksum-verified binary, root `osv-scanner.toml` configuration |
| **OWASP ZAP** | Web dynamic runtime security (DAST headers, cookies, CSP) | Nightly (`zap-baseline-nightly.yml`) | Passive baseline against staging environment |
| **Dependency Audits** | npm + pip-audit sweeps | Weekly (`deps-audit-weekly.yml`) | Automated issue creation for High/Critical advisories |

## 2. Remediation SLAs

When a vulnerability or scanner defect is identified, remediation must occur within the following
calendar-day windows starting from initial detection/triage:

| Severity | CVSS v3/v4 Score | Remediation SLA | Escalation / Action |
|---|---|---|---|
| **CRITICAL** | 9.0 – 10.0 | **7 calendar days** | Immediate hotfix / override / dependency bump. If present in live production images, triggers an incident under `INCIDENT_RESPONSE_RUNBOOK.md`. |
| **HIGH** | 7.0 – 8.9 | **30 calendar days** | Scheduled priority patch, dependency override, or code refactor. |
| **MEDIUM** | 4.0 – 6.9 | **90 calendar days** | Resolved in next standard release milestone. |
| **LOW** | 0.1 – 3.9 | **Best effort** | Handled during regular quarterly dependency refresh. |

## 3. Production Gate & Exception Lifecycle

1. **Zero Unmitigated Critical/High in Production**:
   - Production container images (`Dockerfile.prod`) must not deploy with unmitigated High or Critical vulnerabilities.
   - Production backend and frontend dependencies are updated via Dependabot and reviewed pull requests.

2. **Time-Bound Ignore Policy**:
   - If an immediate upstream fix is not yet available, or if a finding is restricted to non-shipped dev/test/sandbox paths, a time-bound exception may be configured in `osv-scanner.toml`.
   - Every `[[IgnoredVulns]]` entry MUST specify:
     - The vulnerability ID (`id = "GHSA-..."`).
     - A future expiry date (`ignoreUntil = YYYY-MM-DD`).
     - A verified reason documenting why the finding does not impact production (e.g. `'not shipped in any production image, dev/test or sandbox only; revisit if the path becomes deployable'`).
   - Expired entries are automatically rejected by the scanner, enforcing periodic re-triage.

3. **Supply Chain Hardening**:
   - Scanner binaries (Trivy, OSV-Scanner, Gitleaks, Squawk) MUST be downloaded via dedicated installer scripts (`scripts/dev/install_*.sh`) that verify the release archive against hardcoded, published SHA-256 checksums.
   - Direct unverified downloads from untrusted URLs or dynamic release tags are prohibited to prevent supply-chain compromises (such as GHSA-69fq-xp46-6x23).

4. **Notification Timelines**:
   - In accordance with GDPR Article 33 and Section 62a StBerG confidentiality requirements, material security breaches or confirmed production vulnerabilities impacting tenant data require notification to affected tenant controllers without undue delay (within 48 hours of verification).
