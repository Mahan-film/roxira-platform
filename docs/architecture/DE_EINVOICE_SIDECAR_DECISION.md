# DE E-Invoice Generator Sidecar & Offline POS TSE Decision

Status: **Proposed (T271 / R23 & R26)**

## 1. Context

For German B2B e-invoicing (EN 16931 / XRechnung / ZUGFeRD; reception mandatory since 2025-01-01, issuance phased from 2027-01-01 / 2028-01-01), the Enterprise Hub needs a reliable way to generate and validate compliant XML and hybrid PDF/A-3 invoices without sending sensitive tenant invoice payloads to third-party SaaS APIs unnecessarily.

## 2. Decision: Mustangproject JVM Sidecar vs Commercial API

**Chosen default:** Run **Mustangproject** as an isolated internal sidecar service for XML/PDF generation and EN 16931 validation; use a commercial API **only** for network delivery (e.g. Peppol / EDI) when required.

| Criterion | Mustangproject Sidecar (Default) | Commercial SaaS E-Invoice API |
|---|---|---|
| **Data residency & privacy** | Invoice XML/PDF never leaves our infrastructure | Sends full invoice payloads to external vendor |
| **Unit economics** | Fixed container RAM/CPU cost | Per-document or tiered SaaS pricing |
| **Standards support** | EN 16931, XRechnung, ZUGFeRD (note: ZUGFeRD 2.0.1+ details require primary check) | Vendor-managed updates |
| **Operational cost** | Requires JVM container health check & memory limit | External API outage / rate-limit risk |
| **Licence gate** | Apache-2.0 — **must be verified from upstream `LICENSE` file in CI** (`scripts/ci/check_runtime_licences.py`) before adding to runtime images | Proprietary commercial terms |

## 3. Offline POS & Local TSE Note

Per R23 Stage 2 review: **offline POS and a cloud TSE contradict each other** under German KassenSichV / DSFinV-K rules. If a POS terminal must operate while disconnected from the internet, a cloud TSE cannot sign receipts in real time.

- **Policy:** POS is deferred from the initial wedge. When German offline POS is brought into scope, it must integrate a **local or LAN TSE** behind a dedicated hardware/TSE adapter rather than relying on a cloud TSE.
