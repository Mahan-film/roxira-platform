# Roxira Vendor & Sub-Processor Management Policy

> **Policy Reference**: POL-SEC-006  
> **Effective Date**: 2026-11-22  
> **Status**: Active Standard  
> **Master Reference**: Task T289 (#1112)

---

## 1. Purpose & Scope
This policy defines the security, privacy, and compliance governance required when evaluating, onboarding, monitoring, and offboarding external vendors, cloud service providers, and third-party sub-processors.

## 2. Vendor Due Diligence & Contracting
1. **Security Assessment**: Prior to onboarding, any third party handling confidential or customer data undergoes security evaluation (SOC 2 Type II, ISO 27001, or CAIQ verification).
2. **Contractual Enforceability**:
   - All sub-processors processing customer personal or commercial data must execute a Data Processing Agreement (DPA) incorporating EU Standard Contractual Clauses (SCCs) where international transfers occur.
   - Vendors must contractually commit to notification SLAs ($\le$ 48 hours for confirmed security breaches).

## 3. AI Vendor & Model Privacy Constraints
- **Zero Training on Customer Data**:
  - Customer financial, legal, and operational data sent to AI model providers is contractually and technically prohibited from being used to train, fine-tune, or improve third-party models.
  - Commercial enterprise APIs with strict zero-data-retention (ZDR) guarantees are enforced for paying and confidential tenants.
- **Data Sovereignty & Routing**:
  - European / German tax compliance data is routed exclusively through European-resident infrastructure without logging.
  - Any model provider failing zero-retention verification is restricted strictly to synthetic or public law datasets.

## 4. Transparency & List Maintenance
- A public, versioned registry of active sub-processors is maintained in `docs/legal_customer/SUBPROCESSORS.md` and published on the Roxira Trust portal.
- Customers are notified at least 30 days in advance of adding any new sub-processor processing tenant data, with the right to object or request alternate routing.
- 12 months of audit log is our retention for all vendor due diligence records, SOC 2 reports, and sub-processor evaluation audits.
