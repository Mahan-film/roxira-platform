# CI scanner reports & hardening policy

Security scanners run across pull requests, pre-push hooks, and scheduled nightly workflows.
Vulnerability remediation timelines and enforcement rules follow the [Remediation SLA Policy](../security/REMEDIATION_SLA.md).

## 1. Scanner Enforcement Status

- **Gitleaks**: **Blocking** in pre-push hooks (`scripts/dev/pre_push_gitleaks.sh`) and CI (`.github/workflows/ci.yml:gitleaks`). Blocks any commit introducing secret keys or tokens.
- **Agent Guards**: **Blocking** in CI (`scripts/ci/check_agent_guards.py`). Checks added lines for raw tenant queries, float math on money, hardcoded model ids, and plaintext secrets.
- **Pinned Actions**: **Blocking** in pre-push and CI (`scripts/ci/check_pinned_actions.py`). Verifies all 20+ workflow files pin actions to 40-character commit SHAs with version comments and `permissions: contents: read`.
- **Semgrep CE**: **Blocking** on new findings since merge-base (`.github/workflows/ci.yml:semgrep`). Enforces AST rules against `shell=True`, exposed `NEXT_PUBLIC_*` credentials, and controller repository bypassing.
- **Trivy**: Checksum-verified installation via `scripts/dev/install_trivy.sh`. Scans filesystem, CVEs, and IaC misconfigurations (`ci.yml:trivy-fs`). Uploads `trivy-fs-report`.
- **OSV-Scanner**: Checksum-verified installation via `scripts/dev/install_osv_scanner.sh`. Scans tracked lockfiles with root `osv-scanner.toml` ignore rules (`ci.yml:osv-scanner`).
- **OWASP ZAP Baseline**: Nightly passive DAST against staging (`.github/workflows/zap-baseline-nightly.yml`). Checks runtime headers, cookies, CSP, and passive web vulnerabilities.
- **Weekly Dependency Audit**: Automated npm + pip-audit report (`.github/workflows/deps-audit-weekly.yml`). Files an issue for high/critical advisories.

## 2. Supply-Chain Hardening

Following the Trivy supply chain incident (GHSA-69fq-xp46-6x23), scanner binaries are never downloaded
unverified from dynamic URLs. All scanner binaries are fetched through dedicated installer scripts
(`scripts/dev/install_trivy.sh`, `scripts/dev/install_osv_scanner.sh`, `scripts/dev/install_gitleaks.sh`)
that verify the downloaded archive against pinned SHA-256 release checksums before extraction.

## 3. Remediation SLAs

Advisories detected by scanners must be remediated according to [docs/security/REMEDIATION_SLA.md](../security/REMEDIATION_SLA.md):
- **Critical (CVSS 9.0–10.0)**: 7 calendar days.
- **High (CVSS 7.0–8.9)**: 30 calendar days.
- **Medium (CVSS 4.0–6.9)**: 90 calendar days.
- **Low / Informational**: Best effort / quarterly maintenance.

An owner may promote a report-only scanner to blocking in the repository ruleset once its production
paths achieve a clean baseline for two consecutive weeks. Non-shipped paths are excluded via time-bound
ignores in tool configurations.
