# R23 Gemini Deep Research (second opinion)

This report was pasted by the owner earlier, as a two-stage Gemini Deep Research run on R23 (CRM and ERP architecture). It is saved unchanged except: the model's internal "Thoughts" blocks are left out, and the pasted-content wrapper tags are removed. No citation span markers were present in this paste, and no country name or currency name needed replacing (checked by search). Stage 1 was pasted twice; the two copies are byte-identical, so one copy is used. Stage 2 is a critical review written in Persian and is kept in Persian. The Stage 1 "Sources used in the report" list is kept as pasted (titles only, no dates). Treat every claim as UNVERIFIED unless the digest's second-opinion section says otherwise.

## Stage 1

CRM and ERP Architecture Research (R23): Feature Baseline, Open-Source Licensing, Data Model Invariants, Accounting Integration, and Phased Build Strategy for 2026 SMEs

Delivering a closed-source, multi-tenant SaaS CRM and ERP for small-to-mid retail, food, and manufacturing SMEs in 2026 requires resolving a sharp structural gap between buyer expectations and open-source licensing realities. SMEs increasingly expect a unified lead-to-cash, procure-to-pay, plan-to-produce, and point-of-sale suite that handles 2026 statutory mandates—EU structured B2B e-invoicing, POS fiscalization, and lot-level food traceability—out of the box. Yet none of the major open-source CRM or ERP suites can be embedded directly into a proprietary SaaS runtime without triggering prohibitive copyleft obligations or inheriting deep architectural trade-offs. Twenty and Frappe CRM are AGPL-3.0 (prohibited in a closed SaaS runtime), ERPNext is GPL-3.0 (introducing frontend JavaScript distribution risk and heavy serial valuation reposting), and Odoo Community (LGPL-3.0) gates full accounting, barcode scanning, shop-floor execution, quality control, and advanced POS behind a proprietary Enterprise subscription. Among the five benchmarked platforms, only Medusa v2 (MIT core) is permissively licensed for direct runtime reuse; outside those five, a curated set of permissive infrastructure primitives—TigerBeetle (Apache-2.0), Formance Ledger (MIT), Blnk (Apache-2.0), GoRules ZEN Engine (MIT), Temporal (MIT), Mustangproject (Apache-2.0), Typst (Apache-2.0), and Dexie.js (Apache-2.0)—can be safely embedded in a closed runtime.

The highest-leverage architecture is therefore a Domain-Driven Design (DDD) modular monolith on PostgreSQL that reuses permissive infrastructure primitives while custom-building the tightly coupled ERP domain core: a multi-company Universal Party and Product spine, a perpetual FIFO and Moving Weighted Average (AVCO) valuation engine with dual-UoM catch-weight support, a real-time subledger-to-GL posting engine (covering GRNI, partial-receipt 3-way matching, and audit-safe current-period landed cost splits), and an offline-first fiscalized POS. Enforcing seven non-retrofittable database invariants before shipping the first screen—including composite tenant keys with forced PostgreSQL Row-Level Security (RLS), exact NUMERIC multi-currency storage, normalized lot bundles, and temporal validity ranges—allows a team to launch a sellable B2B CRM with native CPQ quoting first, then layer order management, purchasing, perpetual inventory, manufacturing, and POS across subsequent phases without schema rewrites. Key caveats apply throughout: several platform TCO figures trace to partner or third-party tracker estimates rather than published vendor rate cards, legal boundaries around GPLv3 frontend JavaScript distribution remain lightly tested in court, and exact end-of-life dates for Oracle's announced NetSuite POS/SCIS retirement were not disclosed in available documentation.

1. Minimum Complete Feature Set for 2026 SMEs and Platform Benchmark

Small-to-midsize retail, food, and manufacturing enterprises (roughly 10–250 employees) evaluating a unified CRM+ERP in 2026 treat operational execution and regulatory readiness as inseparable. Buyers no longer tolerate disconnected spreadsheets bridging sales quotes, warehouse stock, shop-floor batches, retail tills, and the general ledger.

The 2026 SME Minimum Viable Complete Scope

Commercial Front-End (CRM, Quoting, Orders, and Returns): On the revenue side, SMEs expect modern lead capture (web forms, deduplication, and bidirectional Google Workspace, Microsoft 365, or IMAP/CalDAV email and calendar sync), hierarchical company and contact management, drag-and-drop Kanban pipelines, and activity timelines. Critically, B2B distributors and manufacturers require native line-item quoting (CPQ) connected directly to the ERP catalog—supporting customer-specific price lists, tiered volume discounts, real-time margin visibility, discount approval routing, branded PDF output, and one-click conversion into a Sales Order without rekeying. Downstream order management must cover multi-channel capture (B2B, B2C, e-commerce, POS), draft orders, versioned order edits, hard stock reservations to prevent overselling, partial shipments, and backorders. For post-sale reverse logistics, SMEs expect linked customer Return Merchandise Authorizations (RMAs) and supplier returns with structured return reasons, warehouse inspection and disposition routing (restockable vs. quarantine vs. damaged/scrap), automated credit or debit notes, and exchanges.

Procurement, Inventory, and Perpetual Valuation: On the supply side, baseline expectations include Requests for Quotation (RFQs), supplier price lists and blanket agreements, Purchase Orders (POs), multi-shipment Goods Receipt Notes (GRNs), and automated 3-way matching (PO vs. Receipt vs. Vendor Bill) with configurable price and quantity tolerance holds. Inventory management must span multiple warehouses and storage bins via double-entry stock movements, min/max reorder replenishment, barcode-assisted picking and cycle counting, and perpetual inventory valuation supporting both FIFO (cost layers) and Moving Weighted Average (AVCO/MWA)—plus Standard Cost for repetitive manufacturing—aligned with IFRS/IAS 2, which prohibits LIFO. Importers and distributors further expect landed cost capitalization to allocate freight, customs duties, brokerage, and transit insurance (often 8–30% of product cost according to industry ERP analyses) into inventory valuation rather than expensing them immediately.

Manufacturing, Food Traceability, FEFO, and Catch-Weight: Light-to-mid discrete manufacturers expect versioned multi-level Bills of Materials (BOMs), make-to-stock (MTS) and make-to-order (MTO) work orders, component reservation and staging, work-center routings, shop-floor time and consumption logging, disassembly/rework, and Material Requirements Planning (MRP) combining forecasts, open orders, lead times, and safety stock. Production costing must accumulate Work-in-Process (WIP) across direct materials, direct labor, and applied factory overhead, separate recoverable scrap from abnormal loss, and isolate material, labor, and overhead variances. Food and beverage SMEs add three hard requirements that generic discrete ERPs routinely mishandle: recipe/formula management (batch scaling, variable yields, moisture loss, substitutions, co-products/by-products, and allergen/nutritional declarations under EU FIC Regulation 1169/2011), catch-weight (dual-UoM) tracking where variable-weight meat, seafood, cheese, or produce is counted and picked by case/piece but priced and valued by actual scale weight, and end-to-end lot traceability with FEFO (First Expired, First Out) picking filtered by quality quarantine status and customer-specific minimum remaining shelf life at delivery. Although the U.S. Congress directed the FDA (via the Continuing Appropriations and Extensions Act of 2026) not to enforce FSMA Section 204 before July 20, 2028—extending the original January 20, 2026 date by 30 months—major retail buyers already demand 24-hour sortable electronic traceability records and sub-4-hour BRC/IFS mock-recall readiness commercially in 2026.

Point of Sale (POS) and 2026 European Statutory Compliance: Retail and hospitality SMEs require touch-friendly web or tablet POS with true offline resilience (local write queue and conflict-safe resynchronization), barcode/scale/payment-terminal connectivity, multi-tender payments, split bills, cash-drawer opening/closing variance reconciliation, rule-based promotions and loyalty, and omnichannel stock visibility (BOPIS). Crucially, operating in Europe in 2026 imposes overlapping statutory mandates. For B2B e-invoicing (EN 16931), Germany has mandated structured e-invoice reception since January 1, 2025, with mandatory issuance starting January 1, 2027 (businesses exceeding €800,000 in 2026 turnover) and January 1, 2028 (all remaining domestic B2B businesses) via XRechnung, ZUGFeRD 2.2+, or Peppol BIS 3.0; France enforces mandatory reception for all firms and issuance/e-reporting for large and mid-sized enterprises from September 1, 2026 (automatic penalties deferred through December 31, 2026; SMEs follow September 1, 2027) via accredited Plateformes Agréées; and Poland mandates KSeF clearance in February/April 2026. For physical retail POS fiscalization, Germany enforces KassenSichV requiring BSI-certified Technical Security Devices (TSEs), receipt issuance with TSE serials, DSFinV-K audit exports, 10-year AO/GoBD retention, mandatory ELSTER cash-register notification (active since January 1, 2025), and flexible VAT mapping (such as Germany's 2026 return to 7% VAT on restaurant food). France enforces tamper-proof ISCA/NF525 POS compliance—allowing either third-party accreditation (e.g., NF525/LNE) or manufacturer self-certification as reintroduced in the 2026 Finance Act—alongside register-level B2C e-reporting versus B2B e-invoice routing.

Competitive Benchmark: Odoo, ERPNext, Twenty, Medusa, and Oracle NetSuite

Oracle NetSuite serves as the commercial leader benchmark, with over 44,000 cloud customers worldwide, a unified single-database ERP+CRM+eCommerce architecture, and mature OneWorld multi-subsidiary consolidation. (For reference, Microsoft Dynamics 365 Business Central—now past 55,000 cloud customers at published US list prices of $80/user/month Essentials and $110/user/month Premium billed yearly as of October 2026—beats NetSuite on single-country SMB TCO, but lacks native e-commerce and depends on Power BI and third-party ISVs for reporting and real-time multi-entity consolidation.) Because Odoo's open-source Community edition and commercial Enterprise edition differ sharply in accounting, warehouse, manufacturing, and POS depth, both editions are broken out separately below. Note that Odoo's public editions overview does not itemize every granular sub-feature (such as landed costs or specific country POS certificates) between editions; those distinctions are triangulated from Odoo partner analyses, technical blogs, and repository manifests.

Capability (2026 SME Baseline)	Odoo Community (v19/20)	Odoo Enterprise (v19/20)	ERPNext (v16)	Twenty (v2.0)	Medusa (v2.x)	Oracle NetSuite (Commercial Leader)
CRM (Leads, Pipelines, Email Sync)	Present (leads, pipeline, activities)	Present (adds AI scoring, VoIP, marketing automation)	Partial / Deprecating (built-in CRM removed in v17; Frappe CRM is separate AGPL-3.0 app)	Present (Notion-like UI, custom objects, M365/Google sync, AI/MCP)	Absent (Customer Groups only; no sales pipeline)	Present (native SFA, leads, opps, cases, mobile)
Quotes & CPQ	Present (basic quotations, pricelists)	Present (templates, e-sign, rental, margin rules)	Present (quotations, pricing rules, promo schemes)	Absent natively (no line-item/CPQ grid; requires custom objects)	Partial (MIT B2B Starter adds quotes & approvals; native price lists/tiers)	Present (native estimates; complex CPQ is paid add-on)
Sales Orders & Fulfillment	Present	Present (adds carrier connectors, wave/batch picking)	Present (SO, Delivery Notes, stock reservation)	Absent	Present (multi-channel OMS, draft orders, edits, reservations)	Present (order-to-cash, multi-channel fulfillment)
Purchasing & 3-Way Match	Present (POs, RFQs, receipts)	Present (3-way match, vendor bill OCR, blanket orders)	Present (PO, PR, PI, 3-way controls, debit notes)	Absent	Absent (no POs, suppliers, or replenishment)	Partial (3-way match via SuiteApp; excludes partial receipts natively)
Stock Valuation (FIFO / AVCO / Std)	Present (FIFO, AVCO, Standard; v19 move-level valuation)	Present (full perpetual GL automation & dynamic reports)	Present (FIFO, Moving Average, Standard; perpetual default)	Absent	Absent (quantity tracking per location only; no costing)	Present (Average, FIFO, LIFO, Standard, Specific, Lot)
Lot/Serial, Expiry & FEFO	Present (lots, serials, 4 expiry dates, FEFO removal)	Present (adds Barcode scanner app & Quality gates)	Present (v16 Serial & Batch Bundle, FEFO/FIFO auto-pick, recall tree)	Absent	Absent	Partial (native lots/expiry; FEFO via SuiteApp/WMS)
Catch-Weight (Dual-UoM)	Absent natively (fixed UoM conversion; partner add-ons)	Absent natively (fixed UoM conversion; partner add-ons)	Absent natively (fixed UoM conversion; scale barcode in POS Awesome)	Absent	Absent	Absent natively (requires ISV add-on; Infor M3/SAP lead here)
Multi-Level BOM & Recipes	Present (multi-level BOMs, kits, basic work centers)	Present (adds PLM/ECOs, BOM comparison, Quality)	Present (visual multi-level BOM, scrap items, variants)	Absent	Partial (multi-part kit inventory only; no BOM/MRP)	Present (versioned BOMs, ECOs; discrete focus, weak process/formula)
Production Orders & MRP	Partial (MOs, work centers; limited planning)	Present (Shop Floor tablet UI, planning, maintenance, AI forecast)	Present (v16 dedicated MRP, Work Orders, Job Cards, inward subcontracting)	Absent	Absent	Paid Tiers (Work Orders → WIP & Routings → Adv. Mfg)
Production Costing & Landed Cost	Partial (lacks full official Accounting GL; partner-reported v19 AVCO gap on already-sold COGS)	Present (MO cost analysis, WIP, landed costs; reported v19 AVCO already-sold gap)	Present (v16 LCV on receipts, Mfg & subcontracting; retroactive reposting issue)	Absent	Absent	Present (Std/Avg/Actual costing, variances, landed cost)
POS (Offline, Hardware, Loyalty)	Partial (basic web POS; no floor plan, payment terminals, loyalty, display)	Present (offline web, tables, split bill, terminals, loyalty, IoT)	Partial (native POS is online-only; v16 dual posting mode; offline via POS Awesome/custom)	Absent	Partial (POS build recipe / partner apps only; no native POS)	Retiring (NetSuite POS & SCIS discontinued; lacked true offline; push to In8Sync/VennPOS/Shopify)
POS Fiscalization & EU E-Invoicing	Absent / OCA DIY (lacks official Enterprise compliance packs)	Present (l10n_de_pos_cert, l10n_fr_pos_cert with Odoo SA cert, DATEV, localizations)	Partial (community/partner apps e.g. erpnext_tse & German GoBD apps)	Absent	Absent (pay-by-invoice & e-invoicing custom/ERP)	Partial (OneWorld country packs; POS fiscalization delegated to 3rd-party POS)
Returns & RMA	Present (reverse transfers, credit notes)	Present (v19 automated return unreservation)	Present (Return DN/PR, Credit/Debit Notes, linked qty limits)	Absent	Present (automated RMA, received vs. damaged qty, exchanges, claims)	Partial (native RMA & credit memos; no self-service trigger or inspection disposition without SuiteScript)
Full Accounting & Multi-Entity GL	Absent (Invoicing only; full GL/bank sync via OCA)	Present (full GL, bank sync, ML reconciliation, consolidation)	Present (full GL, v16 custom P&L/BS templates, consolidated trial balance)	Absent	Absent	Present (OneWorld native real-time multi-subsidiary consolidation)
License & Pricing (2026)	LGPL-3.0 (€0 license; self-host/upgrade cost)	Proprietary (€19.90–€44.90/u/mo per partner price checks + hosting)	GPL-3.0 ($0 license; Frappe CRM is AGPL-3.0)	AGPL-3.0 core + Commercial Enterprise ($9 Pro / $39 Org per u/mo Cloud, yearly)	MIT core + B2B Starter; Commercial Enterprise RBAC/SSO	Proprietary SaaS (third-party trackers estimate ~$999–$5k+/mo base + ~$99–$199/u/mo + modules)

Three market insights stand out from this comparison. First, Oracle NetSuite is priced out of the lower SME segment while leaving major retail and food gaps: because Oracle does not publish list pricing, third-party trackers and client-reported estimates put all-in Year-1 NetSuite costs at roughly $50,000–$120,000 for small deployments and $100,000–$270,000 for mid-market rollouts, with 5–15% (and up to 15–20% per migration consultancies) annual renewal uplifts unless capped. Simultaneously, NetSuite is retiring its native POS (NetSuite POS and SCIS—though exact termination dates were unavailable in reviewed partner advisories) and lacks native catch-weight and partial-receipt 3-way matching. Second, Odoo Enterprise leads SME functional breadth, but partner analyses note that Odoo 20 raised its Custom plan rate by 20% in 2026 (reaching €35.90–€44.90/user/month in France per one September 2026 price check) and shifted AI features onto paid Odoo AI credits (€1/credit with bring-your-own-key removed), while rigid annual major-version upgrade cycles make custom deployments costly to maintain. Third, ERPNext v16 has substantially closed its manufacturing and traceability gaps—adding dedicated MRP, normalized Serial & Batch Bundles, and formula-driven financial statements alongside partner-reported ~2× framework speedups (unverified by independent benchmarks)—yet its deprecation of built-in CRM in favor of AGPL-3.0 Frappe CRM, online-only native POS, and operational bottlenecks in retroactive valuation reposting leave clear vulnerabilities.

2. Open-Source Reuse vs. Custom Build Under Closed-SaaS Licensing Constraints

Enforcing a strict closed-SaaS runtime policy—no AGPL, SSPL, or ELv2, and avoiding hidden GPLv3 distribution liabilities—disqualifies every full-suite open-source CRM and ERP from direct runtime embedding.

Why Copyleft Suites Fail Closed-SaaS Due Diligence

AGPL-3.0 (Hard Disqualification — Twenty, Frappe CRM, EspoCRM, SuiteCRM): Section 13 of AGPL-3.0 closes the "SaaS loophole," requiring anyone who modifies the software and offers network interaction to users to make the complete Corresponding Source available. Although Twenty v2.0 adds an "Application Exception" allowing proprietary external applications to communicate with Twenty over a network, Twenty's own LICENSE explicitly specifies that "this additional permission does not apply to Twenty itself: if you modify Twenty, the AGPLv3, including section 13, applies to your modified version in full". Furthermore, Twenty gates enterprise SaaS requirements—SSO, row-level permissions, audit logs, and key rotation—under a separate commercial license. Neither Twenty nor Frappe CRM can be forked or embedded into a proprietary SaaS runtime.

GPL-3.0 (High-Risk Disqualification — ERPNext, Vendure Core): Under traditional copyright interpretation, running GPLv3 code solely on a backend server without conveying binaries does not trigger distribution. However, web-based ERPs transmit substantial JavaScript, HTML, and CSS client bundles into customer browsers; software compliance specialists warn that serving modified or linked GPLv3 frontend JavaScript is widely treated in legal practice as distribution triggering GPLv3 copyleft—even though the exact boundary for script languages has seen little courtroom precedent. Vendure likewise transitioned its open-source Core to GPLv3 alongside a commercial Platform license. Embedding GPLv3 inside a closed SaaS runtime creates unacceptable M&A and fundraising Software Composition Analysis (SCA) risk and blocks shipping an offline POS desktop/mobile wrapper or self-hosted enterprise tier.

LGPL-3.0 (Architectural Friction — Odoo Community): LGPL-3.0 permits proprietary add-on modules that link to an unmodified LGPL library without open-sourcing the proprietary modules. In practice, however, Odoo's Python ORM relies heavily on class inheritance (_inherit), blurring the untested legal line between linking and derivative works, and any modification to core LGPL backend or frontend OWL/JS files triggers source disclosure upon distribution. Commercially, Odoo Community omits full accounting, barcode scanning, shop-floor control, quality management, and advanced POS; implementation partners document that rebuilding missing Enterprise modules on Community routinely exceeds Enterprise license TCO and compounds migration costs at every annual Odoo release.

Permissive Component Reuse vs. Build Matrix

Rather than forking a copyleft monolith, the optimal closed-SaaS strategy is to compose permissive-licensed infrastructure and compliance primitives (MIT, Apache-2.0, BSD-3-Clause, CC0-1.0) while building the multi-tenant CRM+ERP domain core in-house.

Component	Domain	Verified License	Closed-SaaS Safe?	Decision & Architectural Role
Medusa v2 (Core + B2B Starter)	Headless Commerce, Pricing, Promotions, Orders, RMA/Exchanges	MIT (Enterprise RBAC/SSO is commercial)	Yes (MIT core only)	Selective Reuse / Storefront Layer: Decoupled TypeScript/Node/PostgreSQL modules can power B2B/DTC storefronts and OMS, but lack native multi-tenancy, costing, and purchasing, and require guarding against documented v2 pitfalls (coupon stacking on negotiated prices, unauthenticated GET /store/orders/:id, frozen custom line prices on quantity edits, and reservation leaks).
Formance Ledger	Programmable Double-Entry Ledger & Numscript	MIT (core ledger restored to MIT in v2.4)	Yes	Reuse (Strong GL Candidate): Append-only double-entry enforced at the storage layer with bi-temporality (recorded vs. effective timestamps) and atomic multi-posting Numscript expressions.
Blnk	Immutable Double-Entry Ledger	Apache-2.0	Yes	Reuse (Alternative GL Core): Immutable double-entry ledger supporting multi-currency balances, inflight holds, split transactions, and external statement reconciliation.
TigerBeetle	Double-Entry Financial OLTP Database	Apache-2.0 (No CLAs)	Yes	Reuse (Optional High-Volume Core): Purpose-built financial database with 3-replica Viewstamped Replication, 2PC pending transfers, hard balance limits, and vendor-benchmarked >1M batched TPS. Self-hosted only; overkill for MVP, strong for high-volume POS/fintech settlement.
GoRules ZEN Engine	Business Rules Engine (Decision Graphs & Policy Docs)	MIT	Yes	Reuse: Rust core with Node.js, Python, Go, Java, .NET, iOS, and Android bindings evaluating portable JSON rules in microseconds. Ideal for pricing waterfalls, discount non-stacking, GL account derivation, and approval routing. (Note: vendor currently restricts external code PRs to preserve JDM spec control.)
Temporal	Durable Workflow Orchestration	MIT	Yes	Reuse: Durable state/retry orchestration eliminating fragile custom queues for 3-way match approvals, async GL/revaluation sagas, MRP runs, and e-invoice delivery retries.
Mustangproject	EU E-Invoicing (ZUGFeRD ecosystem)	Apache-2.0	Yes	Reuse (Sidecar Service): Apache-2.0 library under the ZUGFeRD GitHub organization suitable for German/EU structured e-invoicing pipelines.
Typst	Programmatic Document / PDF Compiler	Apache-2.0	Yes	Reuse: Commercial-friendly compiler usable as a library for quotes, purchase orders, packing slips, invoices, and batch labels.
Dexie.js / PGlite / ElectricSQL	Local-First Browser Storage & Sync (POS)	Apache-2.0 (PGlite dual Apache-2.0 / PostgreSQL)	Yes	Reuse Dexie.js Now; Watch PGlite Sync: Dexie.js (IndexedDB) paired with a custom idempotent outbox is production-ready for offline POS today; PGlite's ElectricSQL sync alpha does not yet support syncing local writes back upstream.
Lerian Midaz	Financial Ledger	Apache-2.0 (v1.51.0 Go module & MCP server)	Audit Required	Pin & Audit Before Use: LerianStudio maintains internal licensing tooling referencing Apache-2.0, ELv2, and Proprietary switches; verify exact release artifact licenses in CI SCA before adopting.
InvenTree	Parts, Multi-Level BOM, Build Orders, Lot Tracking	MIT (core & manufacturing-costs plugin)	Yes (legally)	Reference Only: Single-tenant Python/Django architecture (maintainers explicitly advise separate containerized installs per tenant); lacks perpetual FIFO/AVCO valuation and GL accounting.
Apache OFBiz / Moqui (Mantle UDM)	Universal ERP Data Models & Framework	Apache-2.0 (OFBiz) / CC0-1.0 + Patent Grant (Moqui)	Yes (legally)	Schema Blueprint Only: Comprehensive Len Silverston Party/Facility/Order/Accounting models (~900 tables in OFBiz), but legacy Java/Groovy XML-widget stacks slow modern SaaS product velocity.
Corteza / Krayin / Saleor	Low-Code CRM / PHP CRM / Composable Commerce	Apache-2.0 (Corteza) / MIT (Krayin) / BSD-3-Clause (Saleor)	Yes (legally)	Stack-Dependent Reference: Corteza (Go/Vue), Krayin (PHP/Laravel), and Saleor (Python/GraphQL commerce) are license-safe, but none provide a unified multi-tenant ERP spine.
Odoo Community	Core ERP Monolith	LGPL-3.0	Conditional / Avoid	Do Not Embed: Enterprise paywall gates accounting, barcode, shop floor, and advanced POS; tight Python ORM inheritance and annual upgrade drag undermine closed-SaaS unit economics.
ERPNext v16 / Vendure Core	Full ERP / Headless Commerce	GPL-3.0	No (JS dist. risk)	Excluded from Runtime: Frontend JS distribution triggers GPLv3 copyleft risk in SCA due diligence; ERPNext also pairs with AGPL-3.0 Frappe CRM.
Twenty v2.0 / Frappe CRM	Modern Sales CRM	AGPL-3.0 (+ Commercial Enterprise in Twenty)	No	Strictly Excluded: AGPL Section 13 network copyleft prohibits proprietary modification in a closed SaaS.

What Must Be Built In-House

Six tightly coupled core modules cannot be stitched together cleanly from permissive open-source components and form the defensible intellectual property of the SaaS platform. First is the Multi-Tenant Control Plane and Unified Master Data Spine—tenant lifecycle management, RBAC, SAML/OIDC SSO, immutable audit logs (notably gated behind paid Enterprise plans in both Twenty and Medusa), legal entities, Universal Party records, and the Product/UoM catalog. Second is the CRM and Native CPQ Line-Item Engine, unifying pipeline execution, email/calendar sync, and structured line-item quotes tied directly to effective-dated price lists and live ERP cost/stock levels (solving Twenty's core B2B quoting gap). Third is the Inventory, Lot/FEFO, Catch-Weight, and Perpetual Valuation Engine implementing double-entry stock moves, normalized lot bundles, dual-UoM weighing, FIFO layer queues, Moving Average calculations, and instant genealogy queries. Fourth is the Purchasing, Partial-Receipt 3-Way Match, and Current-Period Landed Cost Engine, solving both NetSuite's native partial-receipt limitation and ERPNext/Odoo's landed-cost accounting pitfalls. Fifth is the Hybrid Discrete + Food Process Manufacturing and WIP Costing Engine handling versioned BOMs, variable-yield recipes, MRP, shop-floor execution, WIP absorption, and variance settlement. Sixth is the Offline-First POS Client and Pluggable Fiscalization Adapter Layer, pairing a Dexie.js local-first checkout PWA with commercial certified regional fiscal middleware (such as fiskaly, efsta, or fiskaltrust for German BSI Cloud-TSE/DSFinV-K/ELSTER and French NF525/Plateforme Agréée routing) rather than undertaking multi-country hardware and BSI certifications from scratch.

3. Data Model Pitfalls That Cannot Be Retrofitted

UI workflows and reports can evolve continuously after launch, but seven foundational schema invariants harden permanently the moment the first production transactions post. Attempting to retrofit any of these later forces destructive migrations, broken historical audit trails, or full rewrites.

1. Multi-Company (Multi-Entity) vs. Multi-Tenancy

Conflating tenant_id with company_id—or assuming a single Chart of Accounts (COA), fiscal calendar, and base currency per tenant—locks customers out of multi-subsidiary growth. The day a German SME opens an Austrian or US subsidiary or separates manufacturing from retail into distinct legal entities, single-company designs force separate workspaces and manual spreadsheet consolidations. Equally hazardous is resolving company context implicitly from a user's active session: historical Odoo bug reports documented cross-company valuation corruption when power users validated stock moves and the system resolved journals or accounts from the user's session rather than the document's legal entity.

Required Invariant: Separate tenant_id (SaaS security and subscription boundary) from company_id (legal entity owning its own COA, home currency, fiscal calendar, tax IDs, and document sequences) from migration 001. Every transactional document carries an explicit, immutable company_id foreign key, while shared master data (Parties, Products) uses company-scoped extension tables (product_company_settings) to store legal-entity-specific valuation methods and GL accounts. Include corporate-COA account mapping and intercompany due-to/due-from clearing structures early so group consolidation requires configuration rather than re-architecture.

2. Multi-Currency & Exact Monetary Precision

Storing money in IEEE 754 FLOAT/DOUBLE PRECISION, PostgreSQL MONEY, or 32-bit INTEGER cents guarantees accounting corruption at scale. Binary floats cannot represent 0.1 + 0.2 = 0.3 accurately and return non-deterministic SUM() totals across parallel PostgreSQL execution plans. PostgreSQL's MONEY type binds decimals and formatting to the server locale (lc_monetary), carries no currency code, cannot store fractional cents needed for unit costs or per-liter rates, and silently truncates integer division ($10 / 3 = $3.33, dropping $0.01). Storing 32-bit INTEGER minor units overflows at 2,147,483,647 (~€21.47M in 2-decimal currencies—easily breached in cumulative ledgers or coarse-unit currencies) and breaks down when one ERP database mixes 0-, 2-, and 3-decimal currencies alongside 6-decimal unit costs. Failing to convert and freeze foreign-currency amounts into functional currency at transaction time—as seen in Odoo 19 issue #231659, where EUR purchase prices were booked 1:1 into QAR stock valuation—silently distorts inventory assets and COGS.

Required Invariant: Store all monetary values in PostgreSQL NUMERIC(p, s) with explicit scale (for example, NUMERIC(18, 2) or NUMERIC(18, 4) for ledger amounts aligned with currency exponents, NUMERIC(18, 6) for unit costs and UoM prices, and NUMERIC(18, 10) or unconstrained NUMERIC for exchange rates, guarded by CHECK (val != 'NaN') because PostgreSQL NUMERIC accepts 'NaN'). Preserve arbitrary-precision Decimal objects end-to-end in application code—never converting through JavaScript Number floats. Persist three monetary views on every financial line: txn_amount + txn_currency, func_amount + func_currency + immutable fx_rate + fx_rate_type (spot/average/closing), and optional group_amount. Book realized FX gains/losses automatically on payment settlement and run period-end unrealized FX revaluation (with automatic next-day reversal) exclusively on open monetary balances (AR, AP, foreign-currency bank accounts)—never on non-monetary inventory or fixed assets.

3. Multi-Warehouse & Double-Entry Stock Architecture

Updating a mutable quantity_on_hand column directly on a products table destroys auditability, prevents point-in-time valuation ("inventory value as of December 31"), creates race conditions across concurrent checkouts, and cannot distinguish in-transit stock, vendor/customer consignment stock, or shop-floor WIP. Conversely, duplicating every stock movement into a parallel valuation-layer table—as Odoo 18 did before removing stock.valuation.layer in Odoo 19—creates severe table bloat and operational friction around backdated transfers.

Required Invariant: Record every physical stock change as an immutable double-entry stock_move transferring quantity from source_location_id to dest_location_id across typed locations (VENDOR, INTERNAL_BIN, IN_TRANSIT, PRODUCTION_WIP, CUSTOMER, SCRAP, INVENTORY_LOSS). Maintain a transactionally updated balance projection (stock_quant) keyed by (tenant_id, company_id, location_id, product_id, lot_id, owner_party_id) separating on_hand_qty, reserved_qty, and available_qty, with every reservation explicitly linked to source_document_type and source_line_id (preventing Medusa v2's documented reservation-deadlock and orphaned-reservation bugs). Configure valuation level explicitly (company-wide vs. item-warehouse) and track owner_party_id so consigned inventory never inflates balance-sheet assets.

4. Lot/Serial Traceability, FEFO & FSMA 204 Genealogy

Adding lot_number as a loose text column—or expanding one serial number per row directly inside the primary Stock Ledger table—breaks down at scale. ERPNext v15 suffered severe stock-ledger bloat under high-volume batched transactions before refactoring in v16 to a normalized Serial and Batch Bundle structure. Furthermore, ERPs cannot safely flip an SKU from untracked to batch-tracked after unbatched transactions exist. In food and pharma, conflating FIFO accounting with FEFO physical picking—or sorting purely by expiry date without excluding quarantined stock and validating customer-specific remaining shelf life at expected delivery date—causes shipments of ineligible stock.

Required Invariant: Normalize lot and serial allocations into dedicated stock_lot_bundle / stock_lot_bundle_item tables referenced via a single foreign key from stock_move. Store four lifecycle dates on each lot (expiration_date, best_before_date, removal_date, alert_date), explicit quality_status (RELEASED, QUARANTINE, BLOCKED, EXPIRED), immutable upstream traceability_lot_code (TLC) and tlc_source_location_id for FSMA 204 Key Data Elements, and allergen/potency attributes. Write explicit parent-child lot_genealogy edges on every production transformation, split, or repack so forward/backward recall trees and mass-balance audits execute in seconds, while keeping physical removal strategy (FEFO/FIFO/Closest Bin) completely decoupled from financial costing method (FIFO/AVCO/Standard/Specific Lot).

5. Unit of Measure (UoM) Conversion & Catch-Weight (Dual-UoM)

Hardcoding one UoM per SKU or assuming fixed conversion ratios (1 case = 10 kg) fractures purchasing and fails completely in food processing and distribution. Modeling each packaging size as a separate SKU destroys inventory aggregation and demand planning, while fixed conversion factors fail for variable-weight ("catch-weight") goods such as meat, seafood, cheese, and produce that vary in weight per carton and undergo moisture shrinkage in cold storage. Mutating an item's UoM conversion factor in place also corrupts historical BOM yields and purchase price variance analyses.

Required Invariant: Maintain a governed UoM catalog with one canonical base_uom_id per product plus effective-dated item-level conversion factors for purchasing, sales, BOMs, and GS1 GTIN/SSCC pack hierarchies. Snapshot transactional UoM, quantity, conversion factor, and normalized base quantity on every document line. For catch-weight items (is_catch_weight = true), embed parallel Dual-UoM columns on stock_move, stock_quant, and commercial lines: logistics_qty + logistics_uom_id (cases/pieces, governing physical availability—forcing stock to zero whenever logistics_qty = 0 so residual moisture weight is cleared cleanly) alongside valuation_qty + valuation_uom_id (actual weighed kg/lb, governing pricing, inventory valuation, and COGS).

6. Effective-Dated Prices, Tax Rates & BOM Versions

Storing only a single mutable price or tax_rate column—or relying on application-layer checks to prevent overlapping date ranges—causes ambiguous checkout pricing, retroactive corruption of prior-year credit notes when statutory VAT rates shift (such as Germany's 2026 restaurant food VAT change to 7%), and drifting BOM cost baselines.

Required Invariant: Model price lists, tax rates, supplier agreements, FX rates, and BOM revisions as temporal validity tables enforced at the database layer. On PostgreSQL 15–17, enable btree_gist and enforce EXCLUDE USING gist (tenant_id WITH =, pricelist_id WITH =, product_id WITH =, min_qty WITH =, valid_range WITH &&) WHERE (status != 'CANCELLED'). On PostgreSQL 18+, adopt native SQL:2011 temporal primary keys (PRIMARY KEY (tenant_id, pricelist_id, product_id, valid_range WITHOUT OVERLAPS)), and plan forward compatibility with PostgreSQL 19 (in Beta 1 as of 2026), which adds UPDATE/DELETE ... FOR PORTION OF for automatic atomic row-splitting on mid-period price changes. Always freeze resolved price, tax rate, and BOM version snapshots on confirmed documents, while re-evaluating tier rules during cart quantity edits prior to confirmation (avoiding Medusa v2's frozen-custom-price pitfall).

7. Multi-Tenant Isolation Beyond Basic RLS

Relying on ORM global query filters fails whenever raw SQL, reporting endpoints, background workers, or .IgnoreQueryFilters() bypass the ORM pipeline. Enabling PostgreSQL RLS without FORCE ROW LEVEL SECURITY silently allows table-owner application roles to bypass every policy. Worse, issuing session-scoped SET app.tenant_id behind PgBouncer in transaction pooling mode leaks Tenant A's context onto Tenant B's subsequent transaction on the same pooled connection. Omitting tenant_id from primary, unique, and foreign keys leaks record existence across tenants via duplicate-key errors because PostgreSQL constraint checks ignore RLS. Finally, PostgreSQL RLS provides zero protection for Redis caches, background queues, search indexes, or object storage—a well-documented root cause of cross-tenant invoice leaks when two tenants share human-readable IDs like invoice:1001. Attempting to dodge shared-table RLS via PostgreSQL list-partitioning per tenant also fails at scale: Now-Next's September 2026 PostgreSQL 17 benchmarks measured query-planning latency climbing from 2.0 ms at 100 partitions to 77 ms at 1,000 partitions and 241 ms at 3,000 partitions, with over 20 of 32 concurrent clients failing with out-of-shared-memory errors at 1,000 partitions.

Required Invariant: Implement shared tables with PostgreSQL RLS plus full-stack defense-in-depth:

1. Connect the application via a non-owner role lacking BYPASSRLS (reserving BYPASSRLS strictly for schema migrations) and apply both ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY on every tenant-owned table.

2. Place tenant_id as the leading column of every composite Primary Key (tenant_id, id), every UNIQUE constraint, every Foreign Key, and every B-tree index—eliminating cross-tenant constraint leaks and keeping RLS overhead to ~0.01 ms per query (per Now-Next's PostgreSQL benchmarks) by resolving policies via Index Cond.

3. Bind tenant context strictly inside every database transaction via SET LOCAL app.current_tenant (never plain SET), sourced exclusively from verified server-side JWT or session claims—never request bodies—using NULLIF(current_setting('app.current_tenant', true), '')::uuid so missing context fails closed with zero rows.

4. Enforce mandatory tenant prefixing across all non-database stores via centralized helper functions that throw if tenant context is absent: Redis keys tenant:{tenant_id}:{entity}:{id}, S3 prefixes tenants/{tenant_id}/..., explicit job-header tenant propagation in background workers, and tenant-scoped search/analytics indexes.

5. Run automated CI isolation tests exercising 200+ concurrent cross-tenant requests through a real PgBouncer instance in transaction mode, paired with information_schema checks verifying zero unprotected tables and complete GDPR per-tenant export/erasure coverage.

4. Accounting Integration Patterns: Subledger-to-GL Engine

Treating financial accounting as a nightly CSV batch job strips away transaction metadata, creates chronic subledger-to-GL drift, and turns month-end close into manual reconciliation. Instead, every operational domain—Inventory, Purchasing, Sales, Manufacturing, and POS—should emit immutable, typed Accounting Events into a centralized Subledger-to-GL Posting Engine.

Event-Driven Subledger Posting Architecture

The foundation of reliable ERP accounting is a Transactional Outbox with Deterministic Idempotency. Whenever an operational transaction commits (such as validating a Goods Receipt or closing a Work Order), the operational document, immutable stock_moves, and an accounting_outbox_event record are written inside the same PostgreSQL ACID transaction. A deterministic idempotency key ({tenant_id}:{company_id}:{doc_type}:{doc_id}:{event_seq}) ensures exactly-once ledger posting across worker retries and Temporal workflow recoveries.

To decouple operational code from local charts of accounts, Programmatic Account Derivation Rules (evaluated via the MIT-licensed GoRules ZEN Engine) map operational attributes—(company_id, event_type, product_category, warehouse_id, tax_jurisdiction, customer_group)—to balanced Debit and Credit accounts, rejecting any unbalanced entry before commit (total debits must equal total credits in both transaction and functional currencies). Simultaneously, all Subledger Control Accounts (Inventory Asset, GRNI Clearing, WIP, AR Control, AP Control) must enforce allow_manual_posting = false so ad-hoc manual journals cannot corrupt subledger-to-GL tie-out—historically the leading cause of inventory reconciliation discrepancies.

Posting cadence should match transaction volume. B2B receipts, vendor bills, invoices, and production completions should post synchronously or near-real-time (under one minute latency) so margins and cash positions stay current. For high-volume retail POS, support two configurable modes (matching ERPNext v16): Immediate Mode (per-receipt Sales Invoice and GL posting) for low-to-mid-volume stores wanting live intraday ledger visibility, or Shift-Consolidated Mode (preserving granular POS receipt subledgers while posting one summarized GL journal per payment/tax/account grouping at POS Shift Close to avoid GL table bloat). All posted entries must remain strictly append-only (backed by Formance Ledger, Blnk, TigerBeetle, or immutable PostgreSQL ledger triggers). Once an accounting period is locked, corrections are never backdated into closed months; they post as traceable current-period reversing or adjusting entries referencing the original source document.

Valuation & Landed Cost Mechanics: Avoiding Incumbent Traps

Two real-world accounting scenarios frequently trip up ERP engineering teams: how costing formulas reshape reported gross margin on identical stock flows, and how late-arriving landed cost bills interact with already-shipped inventory. ERPNext's Landed Cost Voucher retroactively rewrites historical Purchase Receipt GL entries and enqueues heavy, serial Repost Item Valuation jobs that can stall production queues and disturb closed periods. Conversely, Odoo community forum analyses document that Odoo 19 under AVCO perpetual valuation revalues only the quantity still on hand when a landed cost arrives after partial delivery, failing to generate a COGS adjustment for already-delivered units and thereby overstating gross profit unless manually adjusted or customized. An audit-compliant posting engine avoids both failure modes by posting a current-period proportional split on the freight invoice date—capitalizing the remaining-stock share into Inventory Asset and expensing the already-sold share directly to a COGS Landed Cost Adjustment account without rewriting closed periods.

Canonical Automatic Journal Entry Matrix

Business Event	Trigger Document	Debit Account(s)	Credit Account(s)	Key Invariants & Edge-Case Rules
1. Goods Receipt (PO @ $100 × 10)	Goods Receipt Note (GRN)	1200 Inventory Asset ($1,000)	2105 GRNI Clearing ($1,000)	Creates FIFO cost layer (10 @ $100) or recalculates Moving Average. Under Standard Cost ($95/u), Dr Inventory $950 + Dr PPV $50 / Cr GRNI $1,000.
2. Vendor Bill — 3-Way Match (Bill @ $105 × 10 = $1,050)	Vendor Invoice (within tolerance)	2105 GRNI Clearing ($1,000)
1200 Inventory Asset ($50 if on-hand; or 5110 COGS if already sold; or 5210 PPV under Standard Cost)	2000 Accounts Payable ($1,050)	Must support partial receipts (matching billed qty against cumulative GRN lines). Excess variances outside tolerance route to 2099 AP Disputed Hold. Separate Bill Price Variance, Quantity Variance, and FX Variance accounts.
3. Landed Cost — Estimated Accrual at Receipt	GRN (estimated freight $150)	1200 Inventory Asset ($150)	2110 Accrued Landed Cost ($150)	Capitalizes estimated freight/duty immediately prior to sales; reversed and trued up when the carrier/customs bill arrives.
4. Landed Cost — Late Carrier Bill ($2,000; 8 on-hand, 2 sold)	Landed Cost Voucher (current date)	1200 Inventory Asset ($1,600)
5115 COGS - Landed Cost Adj. ($400)	2110 Accrued Landed Cost or 2000 AP ($2,000)	Audit-ready current-period split: Proportions cost across remaining vs. consumed units on the freight invoice date without mutating closed periods or running serial repost queues. Allocates by Value, Qty, Weight, or Volume.
5. Customer Shipment (Perpetual COGS)	Delivery Note / POS Sale	5100 Cost of Goods Sold (FIFO/AVCO cost)	1200 Inventory Asset (FIFO/AVCO cost)	Paired with Revenue entry (Dr 1100 AR / Cr 4000 Revenue + Cr 2200 VAT Payable). Under POS Shift-Consolidated mode, summarized at shift close.
6. Customer Return (Restockable vs. Damaged)	Return Receipt + Credit Note	4050 Sales Returns (net) + 2200 VAT Payable
If restockable: 1200 Inventory Asset (orig. cost)
If damaged: 5120 Return Scrap Loss (orig. cost)	1100 Accounts Receivable (gross)
5100 COGS (orig. cost)	Warehouse disposition controls whether goods return to sellable inventory or write off to scrap. Price-only credit notes skip stock moves.
7. Vendor Return under AVCO (Bought @ $10, Current AVCO $12)	Purchase Return + Debit Note	2105 GRNI / Stock Input ($10)
5215 Inventory Price Diff. ($2)	1200 Inventory Asset ($12)	Reconciles supplier credit at PO price against AVCO asset removal without distorting remaining stock's average cost. Debit Note clears Dr AP $10 / Cr GRNI $10.
8. Manufacturing — Material Issue & Conversion Absorption	Work Order Issue / Operation Log	1220 WIP - Materials (raw cost)
1225 WIP - Conversion (labor + overhead)	1210 Raw Materials Inventory
5021 Direct Labor Absorbed
5022 Mfg Overhead Absorbed	Moves raw stock into WIP in real time as materials issue and work-center time posts. Abnormal scrap expensed immediately, never capitalized in WIP.
9. Manufacturing — Finished Goods & Variance Close	Production Completion & MO Close	1230 Finished Goods Inventory (COGM)
1235 Recoverable Scrap Inv. (resale value, if any)
5031/5032 Mfg Variances (if unfavorable)	1220 WIP - Materials
1225 WIP - Conversion
5031/5032 Mfg Variances (if favorable)	Zeroes WIP on closed work orders and splits material usage, labor efficiency, and overhead variances cleanly for margin analysis.
10. Cycle Count Shrinkage / Negative Stock True-Up	Stock Adjustment / Late Receipt	5130 Inventory Shrinkage (COGS sub-acct) or 5118 COGS Cost True-Up	1200 Inventory Asset	Book shrinkage inside a COGS sub-account so gross margin reflects physical loss. Block negative stock by default; where retail/POS requires override, log fallback cost and post a traceable current-period COGS true-up upon receipt.

Because many SMEs keep statutory bookkeeping with an external tax advisor during initial rollout, the Posting Engine should treat both the native General Ledger and external accounting connectors (DATEV export for Germany, Xero, QuickBooks) as pluggable ledger sinks subscribing to the exact same canonical subledger journal events. Customers can start with external-bookkeeper sync and activate full internal accounting later with zero operational rework.

5. Phased Build Order: Sellable CRM First, Full ERP Later

Building an entire ERP in stealth delays revenue and customer feedback for years, whereas shipping a naive standalone CRM forces a costly schema rewrite once inventory and accounting arrive. Structuring the platform as a DDD Modular Monolith on a single PostgreSQL cluster—applying the Shared Identity and Domain Aspect Separation patterns used in modern enterprise domain models—allows Phase 0 to lock down the permanent ERP spine, Phase 1 to ship a commercially sellable B2B CRM and quoting product, and Phases 2–5 to activate ERP bounded contexts incrementally. The 18-month horizon below is an illustrative delivery sequence for a focused product-engineering team; exact calendar duration scales with engineering headcount and regional compliance scope.

Phase-by-Phase Execution Blueprint

Phase 0 — The Non-Retrofittable Spine (Weeks 1–4): Before building any CRM UI, establish the permanent multi-tenant kernel. Deploy shared PostgreSQL tables with ENABLE and FORCE ROW LEVEL SECURITY, (tenant_id, id) composite PKs/FKs/indexes, a SET LOCAL transaction middleware verified behind PgBouncer in transaction mode, mandatory tenantKey() wrappers across Redis/S3/queues, RBAC, SSO (OIDC/SAML), and immutable audit logs. Implement a pragmatic Universal Party core (party, person, organization, party_role, party_relationship with validity ranges) inspired by Len Silverston and OFBiz—avoiding excessive EAV indirection while letting one entity hold LEAD, CUSTOMER, SUPPLIER, and CARRIER roles cleanly. Stand up the minimal product identity with base_uom_id, is_catch_weight, and domain-aspect extension tables (product_sales_aspect, later product_inventory_aspect and product_production_aspect), exact NUMERIC tri-currency columns, PostgreSQL temporal exclusion/overlap constraints, the transactional outbox table, Temporal (MIT), GoRules ZEN Engine (MIT), and automated CI SCA license gates blocking AGPL/SSPL/ELv2/GPL.

Phase 1 — Sellable B2B CRM & Native CPQ Quoting (Months 1–3): Launch a standalone, revenue-generating B2B CRM that differentiates immediately against lightweight CRMs like Twenty by delivering native line-item quoting (CPQ) out of the box. Ship leads, companies/contacts (on Universal Party), deals with Kanban/Table/Calendar views, bidirectional Google Workspace, Microsoft 365, and IMAP/CalDAV sync, activity timelines, workflow and SLA automation (Temporal + ZEN rules), effective-dated customer price lists and tiered volume discounts, a structured line-item Quote Builder with margin checks and approval routing, branded PDF generation (Typst, Apache-2.0), REST/GraphQL APIs, webhooks, and a permission-scoped MCP server for AI agents. Because every Quote already captures company_id, txn_currency/func_currency with frozen FX rates, product_id, and uom_id conversion snapshots, upgrading CRM tenants into Phase 2 Sales Orders requires zero schema migration.

Phase 2 — Order Management, E-Invoicing & RMA (Months 4–6): Expand CRM adopters into Quote-to-Cash for wholesale, B2B trading, and e-commerce SMEs while directly addressing 2026–2027 EU B2B e-invoicing mandates. Activate one-click Sales Order conversion from accepted quotes, draft orders, versioned order edits, Net payment terms and credit limits, customer invoicing and credit notes, EN 16931 structured e-invoicing (XRechnung and ZUGFeRD 2.2+ via the Apache-2.0 Mustangproject library paired with Peppol/Plateforme Agréée access-point adapters), customer RMA workflows with structured return reasons and inspection disposition states, and an optional B2B self-service portal or Medusa v2 (MIT) storefront connector. Emit canonical AR events to pluggable DATEV, Xero, and QuickBooks connectors so customers can run live billing alongside their existing tax advisor.

Phase 3 — Inventory Core, Purchasing & Automated Perpetual Accounting (Months 7–10): Unlock full Wholesale & Distribution ERP contract value by activating multi-warehouse typed locations, immutable double-entry stock_moves, order-linked stock reservations, normalized stock_lot_bundle tracking with four expiry dates and FEFO picking (enforcing customer minimum remaining shelf life), catch-weight dual-UoM weighing on receipts and shipments, min/max replenishment, and mobile PWA barcode picking/cycle counting. In parallel, deliver RFQs, vendor price lists, POs, multi-shipment GRNs, partial-receipt 3-way matching (Temporal approvals + ZEN tolerances), purchase returns, and debit notes. Tie operations to finance via the perpetual FIFO and Moving Average (AVCO) engine, GRNI clearing, current-period Landed Cost allocation (splitting remaining stock vs. already-sold COGS), the Subledger-to-GL Posting Engine (on PostgreSQL or Formance Ledger MIT / Blnk Apache-2.0), full multi-company GL, bank statement import/reconciliation, realized/unrealized FX revaluation, and period-close locking.

Phase 4 — Manufacturing, Recipes/BOM & Production Costing (Months 11–14): Enter the Food & Beverage and Discrete Light-Manufacturing SME market—targeting companies underserved by discrete-only ERPs and priced out of Infor M3 or NetSuite Advanced Manufacturing. Ship effective-dated multi-level BOMs alongside process manufacturing formulas/recipes (variable yields, moisture loss, substitutions, co-products/by-products, EU FIC 1169/2011 allergen roll-ups), Work Orders and Work Center routings, a shop-floor tablet PWA (material issue, labor/machine time logging, quality hold/release gates, scrap/rework), an MRP planning engine combining forecasts, open orders, and lead times into suggested POs and Work Orders, WIP accounting (material issue, labor/overhead absorption, COGM receipt, actual-vs-standard variance settlement), and one-click FSMA 204 / BRC / IFS forward-backward genealogy exporting 24-hour sortable traceability spreadsheets.

Phase 5 — Offline-First Retail POS & Pluggable Fiscalization (Months 15–18): Complete the Omnichannel Retail & Hospitality SME suite, capitalizing directly on Oracle's retirement of NetSuite SCIS POS and ERPNext's online-only native POS gap. Deliver a touch-optimized browser/tablet PWA backed by Dexie.js (Apache-2.0 IndexedDB) with an idempotent local write queue and automatic delta synchronization on reconnect; integrate barcode scanners, electronic scales (populating catch-weight lines directly), ESC/POS receipt printers, and payment terminals; run multi-tender payments, split bills, and local promotions/loyalty via embedded GoRules ZEN rules; support both immediate per-receipt and shift-consolidated GL posting; and integrate certified regional fiscalization middleware (such as fiskaly, efsta, or fiskaltrust) through a Country Fiscalization Adapter covering German BSI Cloud/USB TSE signing, DSFinV-K exports, and ELSTER registration alongside French ISCA/NF525 logging and B2C e-reporting vs. B2B e-invoice routing.

Cross-Phase Engineering Governance Guardrails

To preserve velocity across all five phases without accumulating ERP-scale technical debt, enforce three permanent engineering guardrails:

1. Maintain a Single Database Cluster with Logical Module Boundaries: Never split CRM and ERP into separate databases with fragile bidirectional sync; isolate bounded contexts via PostgreSQL schemas and strict internal service contracts inside the modular monolith, extracting a dedicated service only when empirical profiling shows a specific workload (such as high-throughput POS sync or heavy MRP batch runs) saturating vertical capacity.

2. Automate Financial and Isolation Invariants in CI: Gate every pull request with deterministic regression suites verifying FIFO/AVCO/Standard parity, partial-receipt 3-way matching, post-sale landed cost COGS splits, multi-currency FX settlement, catch-weight shrinkage zeroing, zero subledger-to-GL drift, and concurrent multi-tenant PgBouncer RLS isolation.

3. Enforce Continuous SCA and SBOM Compliance: Run automated Software Composition Analysis in CI/CD on every build with an explicit runtime license allowlist (MIT, Apache-2.0, BSD-2/3-Clause, ISC, CC0-1.0), automatically failing any commit whose direct or transitive dependencies introduce AGPL, SSPL, ELv2, or GPL.




Sources used in the report
  What are the Differences Between Community & Enterprise in Odoo

  Odoo Enterprise vs Community | Odoo Editions Comparison

  Odoo Community or Enterprise? An honest comparison - Zebroo

  Odoo 18 vs Odoo 19 - Boyang Consultancy Services

  Odoo Community vs. Enterprise: Unterschiede, Support und Kosten

  Odoo Community vs Enterprise (2026): Features, Costs, Hosting

  Odoo Community vs Enterprise: Which Edition Is Best for Your

  Manufacturing - InvenTree Documentation

  Deploy & Host InvenTree | Open-Source Inventory Management on

  An InvenTree plugin for capturing manufacturing cost data - GitHub

  inventree-docs/LICENSE at master - GitHub

  Twenty CRM 2026: Open Source Alternative zu Salesforce

  twenty/LICENSE at main - GitHub

  Best Open-Source CRM in 2026, Compared - Munin

  Twenty: open source alternative to Salesforce Sales - SIAX

  Twenty CRM Review 2026: Pricing, Self-Hosting and Limits

  B2B ecommerce platform with quotes, company accounts and

  B2B Commerce with Medusa v2: Company Accounts, Price Lists

  What is Medusa.js? v2, hosting and cost explained - Evelumo

  Medusa.js Features Overview (2026): What Is Medusa and ... - Rigby

  Implement Quote Management in Medusa

  Medusa: Pricing, Capabilities and Fit - Ecommerce Guide

  FSMA Final Rule on Requirements for Additional Traceability Records

  ERP Software for Food and Beverage Industry 2026

  FSMA 204 traceability for food manufacturing ERP teams - Bonx

  Food Traceability Guide: FSMA 204, BRC and IFS Explained (2026)

  FSMA 204 Requirements for Food Distributors - Net at Work

  NetSuite vs Dynamics 365 Business Central for 2026

  NetSuite vs Dynamics 365 Business Central (2026) - BrokenRubik

  NetSuite vs. Dynamics 365 Business Central - Azdan

  NetSuite vs Dynamics 365 Business Central: Which ERP Wins in

  NetSuite vs. Microsoft Dynamics 365: Cloud ERP Comparison

  Blnk Finance – The Open Source Ledger for Financial Products

  Formance vs TigerBeetle: Ledger vs Engine

  GitHub - blnkfinance/blnk: Blnk is an open-source ledger & financial

  TigerBeetle

  5 Best Fintech Ledger Tools for Startups Compared - Fintechspecs

  Building a Double-Entry Ledger with Elixir and TigerBeetle - Medium

  Formance vs. TigerBeetle vs. Fragment: Choosing a Core Ledger

  Odoo Community vs Enterprise: 3-Year Cost and Features 2026

  Odoo Community vs Enterprise: which one to choose

  Odoo Community vs Enterprise - Deep Vision

  ERPNext Version 15 - Features & Updates - Frappe

  ERPNext Version 16 Release Notes: Complete Feature Guide

  Open Source ERP Software for Distribution Manufacturing - Frappe

  ERPNext Version 16 - Features & Updates - Frappe

  ERPNext CRM vs Frappe CRM: the workflow decides the switch

  ERPNext CRM vs Frappe CRM: Which to Use | Metageeks

  ERPNext POS vs Traditional POS Systems: What Changes ... - Ksolves

  Corteza - Corteza

  Open Source ERP Compared: The 7 Systems That Matter in 2026

  Saleor - Composable, Open Source, Headless Ecommerce Platform

  Apache OFBiz - Wikipedia

  Apache OFBiz - das moderne Open Source Web-Development

  ERPNext vs Odoo | Honest Comparison | Finstein

  Average price on returned goods — Odoo 19.0 documentation

  Odoo Removal Strategies: FIFO, LIFO, FEFO Setup Guide

  Odoo 19 Inventory Valuation: FIFO, AVCO, Standard & Landed Costs

  FIFO or average cost in Odoo: choosing a valuation method you can

  Landed Cost Impact on COGS – Odoo v19 Observation

  Postgres Row Level Security for Multi-Tenant SaaS, Explained

  How to architect multi-tenant SaaS on Postgres - ClickHouse

  Multi-Tenant SaaS on PostgreSQL: Row-Level Security, Schema

  Postgres row-level security leaks across tenants when using a

  PostgreSQL Row-Level Security for Multi-Tenant SaaS

  Postgres Row-Level Security: Policies, Pitfalls, Performance

  Multi-tenant SaaS on PostgreSQL: six decisions - Now-Next

  Postgres Row-Level Security with EF Core: Multi-Tenant Isolation

  NetSuite Applications Suite - Costing Methods - Oracle Help Center

  NetSuite Modules Guide: Key Modules, Pricing & FAQs

  NetSuite CRM: Features, Cost & Limits (2026) - BrokenRubik

  NetSuite ERP for Manufacturing | MRP, BOM, Shop Floor & Costing

  NetSuite Lot Expiry and FEFO Picking Requirements - CuriousRubik

  FIFO and Moving Average - Frappe Documentation

  Inventory valuation – Comarch ERP Enterprise 6.5 Knowledge Base

  Work in Process Inventory: How Transactions Affect Costs - Xorosoft

  Inventory Valuation in ERP 2026: FIFO, WAVG, Standard Cost

  Retail Compliance in France: An Overview of Retail & POS with efsta

  E-Invoicing in Europe 2026: Mandates, Deadlines and Your POS

  E-Invoicing Europe Roadmap: 2026–2030 Key Deadlines

  Point-of-sale systems in 2026: TSE requirement, reporting obligation

  Germany e-invoicing: What businesses must complete before 31

  2026 Germany (2026 eInvoicing Country Sheet)

  COGS Journal Entry: Perpetual vs Periodic, With Examples

  Guide: journal entries for perpetual inventory system - Cleverence

  How Sales, Purchase, and Perpetual Inventory Accounting Work in

  Multi-Currency & Multi-Entity ERP for Manufacturers - Bizowie

  Why Multi-Entity Reporting Is So Hard in ERP Systems (And ... - FYIsoft

  Oracle ERP Financial Reporting: Multi-Currency Consolidation

  How do Units of Measure (UOM) work within an ERP system - Syspro

  How cloud ERP supports multi-currency & multi-company financials

  How does SAP ERP handle multi-currency accounting in global

  Sync using Electric | PGlite

  What Is Three-Way Matching & Why Is It Important? - NetSuite

  NetSuite 3-Way Match Not Working? How to Fix Variances

  Return Authorization (RMA) Forms - NetSuite - Oracle Help Center

  NetSuite Returns Processing and RMA Configuration - SuitePacific

  Landed Cost in NetSuite: Setup and Receipt Workflow Guide - Versich

  Average Cost Method: Complete Guide to Inventory Valuation and

  Inventory Valuation Methods: 7 Rules for FIFO, Weighted Average

  Landed Cost Voucher in ERPNext is according to good accounting

  ERPNext Repost Item Valuation Stuck? Causes & the Fix (2026)

  Landed Cost Voucher should not backdate/repost GL & Stock

  Landed Cost Voucher - Frappe Documentation

  ERPNext v16 POS: Sales Invoice vs POS Invoice

  POS Awesome is an open-source Point of Sale for Erpnext ... - GitHub

  Offline-First POS for ERPNext - ECOSIRE

  OSS License Compliance for Startups: GPL, AGPL, MIT and Apache

  Open Source Software Licenses 101: The LGPL License | FOSSA Blog

  Will GPL Force You to Open-Source Your Code? [SA 2026]

  Understanding the SaaS Loophole in GPL | Revenera Blog

  Distribute the code as closed source and the end users download

  When does independently developed software have to be licensed

  Looking Forward to Postgres 19: It's About Time - pgEdge

  PostgreSQL Temporal Tables: INSERT, UPDATE & DELETE

  Exclusion Constraints in Postgres - Java Jedi - Medium

  PostgreSQL 19 Temporal Data Operations

  Three-Way Matching Calculator | PO, GRN & Invoice Reconciler

  Purchase Price Variance (PPV): Formula, Entries and ERP

  GitHub - formancehq/ledger: The programmable open source core

  Odoo Enterprise oder Odoo Community? - Ratocon

  What are the Differences Between Odoo 18 Community & Enterprise

  Odoo Community vs Enterprise: key differences - doo.FINANCE

  mustangproject/LICENSE at master - GitHub

  GitHub - gorules/zen: Open-source Business Rules Engine for your

  GitHub - electric-sql/electric-pglite: Embeddable Postgres with real

  zen/LICENSE at master - gorules - GitHub

  NetSuite Pricing in 2026: Costs, Model & TCO - Concourse AI

  NetSuite POS: Point of Sale Options & Setup Guide (2026)

  NetSuite Pricing 2026: Licensing, User Costs & Modules

  NetSuite POS & SuiteCommerce In-Store Are Being Retired

  Medusa API — Docs, Pricing & OpenAPI - APIs.io

  V2 Overview - Medusa

  Krayin: Health, Licence & Alternatives (2026) - IdeaProof

  corteza/LICENSE at 2026.9.x - GitHub

  Vendure Pricing 2026 Explained: Costs, Hosting, GPLv3 & TCO

  Vendure licensing: GPLv3, plugins and the commercial licence

  saleor/LICENSE at main - GitHub

  multi company : stock valuation problem · Issue #3466 - GitHub

  Multi company : stock valuation bug · Issue #26112 - GitHub

  Inconsistent behavior on Product valuation (FIFO) #231659 - GitHub

  inventree/InvenTree: Open Source Inventory Management System

  Standard Valuation Method For Stock/Inventory Valuation #49983

  The stock.move Model: Odoo's Inventory Movement Architecture

  New era of stock valuation in Odoo 19: Simpler, yet broader in scope

  Automatic inventory valuation — Odoo 18.0 documentation

  Odoo Inventory Guide: Features, Use Cases & AI in Odoo 20

  Using inventory valuation — Odoo 18.0 documentation

  What is ERP Multi-Currency Accounting? - Hyperbots

  Realised vs unrealised FX gains and losses, explained - ERP Yeti

  Multicurrency Accounting: An Essential Guide | Acumatica Cloud ERP

  A Guide to Multi Currency ERP for Growing SMEs - Consensus Blog

  Module Boundaries With Bounded Contexts in Modular Monolith

  SAP's One Domain Model and Domain Driven Design

  Odoo. Open Source Apps To Grow Your Business. - GitHub

  OUR_MODULES_DIFF.json - mao-odoo - GitHub

  temporal/LICENSE at main - GitHub

  electric/LICENSE at main - GitHub

  temporal.io - GitHub

  Why Your Scrap Costing Is Wrong: Tracking Actual vs BOM Scrap in

  WIP Accounting Explained: From Work Order to COGS | Axolt

  Manufacturing Costing in ERP: Standard vs. Actual Costs and Why It

  ERPNext Manufacturing Costing: BOM vs Actual Cost - Turqosoft

  Units of Measure (SAP Library - Catch Weight)

  ERP software solutions for products with variable unit weights

  How ERP Systems Simplify Unit of Measure (UoM) Conversion in

  Unit of Measure (UoM) – Conversion & Consistency - SG Systems

  Method and system for catch-weight management - Google Patents

  Multiple units of measure (UOM) - E21 ERP

  Dual Unit-of-Measure Catch Weight Management in SAP Extended

  Twenty CRM Features, die ein Vertriebsteam wirklich braucht

  Twenty CRM vs Salesforce: Cost, Features, Fit - Opsily

  What is CPQ? A Plain-English Guide (2026) - Finrite

  Twenty CRM is missing a crucial sales/quoting feature - Reddit

  Why Is numeric So Popular in PostgreSQL Databases? - pgEdge

  PostgreSQL numeric vs double precision vs money - DEV Community

  Money in PostgreSQL: numeric, integer cents or money? - Now-Next

  Integer vs Decimal Money Postgres: Two ERPs, Two Answers

  PostgreSQL NUMERIC vs DOUBLE PRECISION: Which Should You

  Working with Money in Postgres | Crunchy Data Blog

  Is there a way to make this multi tenant · Issue #556 - GitHub

  Automated Journal Adjustments: Subledger Patterns That Work

  A Case Study on Workday Accounting Center

  sub-ledger posting rules to general ledger in Microsoft Dynamics

  General Ledger in ERP: A Complete Modernization Guide - DualEntry

  Ledger and subledger accounting overview - Microsoft Learn

  license - Dexie.js - GitHub

  Dexie.js - Offline-First Database with Cloud Sync, Collaboration

  The 3-Clause BSD License - Open Source Initiative

  Odoo Community vs Enterprise: Who Should Actually Pay

  Odoo Community or Enterprise: which edition should an SME choose?

  Batch - Frappe Documentation

  ERPNext v16 Batch Traceability & Instant Recall Guide

  Serial and Batch Bundle - Frappe Documentation

  Order Return - Medusa Documentation

  Is there an open-source order management system I can extend?

  Medusa Inventory Management: Products, Stock and Channels

  How do I manage inventory across multiple warehouses and sales

  Medusa v2 Storefront, Inventory and Workflow Fix Guides - Allan Niñal

  adapting open-source software for enterprise

  Party Data Modeling - Stack Overflow

  sql - What are the principles behind, and benefits of, the "party model"?

  Work-in-Process Inventory Accounting: Tracking Value Through the

  Work-in-Progress (WIP) and Absorption Accounting - SmartERP

  Odoo Accounting For Manufacturing: A Detailed Guide - Ledger Labs

  Negative Inventory Accounting: The COGS Trap - Xorosoft

  How Transactions Affect the Ledger | ERPNext Documentation

  NetSuite Negative Inventory: Causes, Prevention & Fixes

  Perpetual vs Periodic Inventory: Journal Entries Compared

  ERPNext COGS: Trading Account vs Perpetual Inventory - Login

  TSE Integration | Frappe Cloud Marketplace

  Germany Fiscalization and TSE Compliance Requirements Guide

  TSE and register registration with the tax office, explained simply

  Fiscal cash register rules: TSE, NF525, ÖKC - ITproposal

  Fiscalization in Germany - KassensichV, TSE, DSFinV-K - Efsta

  Information platform for the Cash Register Security Ordinance

  GitHub - Rocket-Quack/erpnext_tse: TSE Integration für ERPNext

  ERPNext Deutschland | Open Source ERP - Frappe

  Odoo Italie et fiskaly : des tickets fiscaux sans caisse RT

  moqui-framework/LICENSE.md at master - GitHub

  Open Source - Typst

  Moqui Documentation

  Moqui Ecosystem - GitHub

  typst/LICENSE at main - GitHub

  GitHub - LerianStudio/lerian-mcp-server: A MCP server to support all

  github.com/LerianStudio/midaz | Go | Open Source Insights

  Ring:Applying Licenses by LerianStudio — AI Skill for Any LLM

  Sales Return - ERPNext - Frappe Documentation

  Debit Note - ERPNext - Frappe Documentation

  Purchase Return - ERPNext - Frappe Documentation

  Credit Note - ERPNext - Frappe Documentation




Sources read but not used
  Odoo 18 vs Odoo 19: Complete Feature Comparison Guide (2026)

  inventree-mcp/LICENSE at main - GitHub

  InvenTree - InvenHost Code

  Releases · inventree/InvenTree - GitHub

  Simple Self-hosted Home/Small Office Opensource Inventory ... - v4d

  InvenTree documentation - GitHub

  Stock and Stock Locations - InvenTree Documentation

  Open-Source CRM & Salesforce Alternative - Twenty - AgentCeres

  Open Source CRM: Best Options for Devs in 2026 | Founding.dev

  GitHub - youngsecurity/crm-twenty: Building a modern alternative to

  Best Open Source CRM Tools in 2026

  Twenty | #1 Open Source CRM

  Medusa vs Shopify 2026: Cost, B2B & Headless Trade-offs

  b2b-cloud - medusajs - GitHub

  Inventory: purchase prices #4455 - medusajs medusa - GitHub

  FSMA 204 Traceability: Food Label Requirements for 2026

  FSMA 204 Traceability List - Rules & Requirements Guide - Datacor

  2026 FSMA 204 Food Plant Traceability System Requirements

  NetSuite vs Dynamics 365: 2026 ERP Comparison Guide

  Business Central vs NetSuite: 2026 Total Cost of Ownership

  NetSuite vs Business Central: Which ERP Wins? (2026) - YouTube

  Microsoft Dynamics 365 Business Central vs Oracle NetSuite 2026

  Tigerbeetle | APIs.io Providers

  High-Throughput OLTP in Three Simple Steps - TigerBeetle

  Start - TigerBeetle Docs

  Odoo Community vs Enterprise – what's the right choice for you?

  Odoo Community vs. Odoo Enterprise

  Introduction - Frappe Documentation

  Releases · frappe/erpnext - GitHub

  erpnext/license.txt at develop - GitHub

  ERPNext Version 16 compability #2765 - POS-Awesome-V15 - GitHub

  ERPNext Version16 (V16) Feature Request · Issue #51056 - GitHub

  Stock and Manufacturing Demo in ERPNext - YouTube

  ERPNext vs Frappe CRM: What's the Difference? | Frappe Blog

  Comparisson: Frappe CRM or ERPNext - Reddit

  Odoo vs ERPNext: Complete Comparison Guide | Digital Dividend

  ERPNext vs Odoo for Professional Services: 2026 Comparison

  What is ERPNext? Modules, Real Costs and Its Limits - Managely

  Difference between ERPNext and Frappe CRM

  Frappe Fights: Investing in ERPNext vs other apps - YouTube

  The Apache OFBiz® Project - Apache Software Foundation

  Apache OFBiz - Microsoft Marketplace

  Corteza: Free Open Source Low Code Platform - YouTube

  Apache OFBiz Reviews & Features 2026 - OMR

  ERPNext vs Odoo vs SAP: Complete ERP Comparison | Data Value

  ERPNext vs. Odoo -

  Odoo vs ERPNext | 2026 Open-Source ERP Comparison

  Open-Source ERP (ERPNext, Odoo Community) vs Custom ERP

  ERPNext vs Odoo: Comparison for Swiss SMEs - Centura AG

  Odoo Relicensing to LGPLv3: OCA's Official Position

  Are SaaS Companies Immune to Open Source Risk? - Black Duck

  Licenses — Odoo 20.0 documentation

  Open-Source ERP — DACH SMB Overview, Licensing and TCO

  FIFO vs AVCO in Odoo 19: Inventory Costing Explained - Machinser

  Guidance on Changing Inventory Costing Method from FIFO ... - Odoo

  Landed costs — Odoo 20.0 documentation

  How Odoo 19 Makes Landed Cost Management Easy ... - YouTube

  NETSUITE FOR MANUFACTURERS

  NetSuite Solutions for Manufacturing Businesses - ERP Peers

  NetSuite CRM

  Beyond FIFO & LIFO: 4 Inventory Costing Methods in Accounting

  Oracle® Cost Management

  Exploring the Inventory Valuation Methods in SAP Business One

  Costing - SYSPRO Help

  Inventory Valuation Methods in ERP: FIFO, Average - NetRay

  Inventory Valuation Methods: FIFO, Weighted Average and More

  Valuation of stock movements and inventory operations - Odoo

  Inventory system accounting: methods, mapping, and setup guide

  Automatic COGS for QuickBooks and Xero - NeonPanel

  2.2 Perpetual v. Periodic Inventory Systems

  Perpetual Inventory Methods and Formulas - NetSuite

  Cost of Goods Sold (COGS) in a Perpetual Inventory System - Cin7

  Perpetual Inventory Systems - principlesofaccounting.com

  Journal Entries for Perpetual Inventory | PDF | Cost Of Goods Sold

  Perpetual Inventory Accounting: How Inventory Reaches the GL

  Multi-Company & Multi-Currency ERP Software | FACT ERP.NG

  Multi-currency payment data corruption - ERPNext - Frappe Forum

  Product Guide ERP [Financial Management] - Unit4

  (PDF) ERP SYSTEMS AND WAREHOUSE MANAGEMENT BY WMS

  Local-First App with Zero sync or ElectricSQL & TanStackDB #12506

  3-Way Matching in NetSuite: Automation Guide (2026) | Cedalio

  3 Way Match Vendor Bill Approval Workflow - Oracle Help Center

  3 way matching in accounts payable for NetSuite - Rillion

  Return Authorization - NetSuite

  Entering a Standalone Return Authorization - Oracle Help Center

  Understanding Inventory Costing Methods: Standard Cost, Layered

  What are the pros and cons of each of the different Inventory Costing

  Odoo Inventory Valuation: FIFO vs AVCO Complete Guide 2026

  Four Inventory Costing Methods Compared: A 2026 Guide

  Inventory valuation methods: FIFO vs. Moving weighted average

  invetory valuation methods and their impact on the company´s profit

  Repost Item Valuation - Frappe Documentation

  Cost of Goods Sold in ERPNext - YouTube

  Stuck in Item valuation reposting in progress · Issue #41493 - GitHub

  Open Source Licenses: An In-Depth Analysis

  Frequently Asked Questions about the GNU Licenses

  Documentation: 19: 5.7. Temporal Tables - PostgreSQL

  Postgres exclude using gist across different tables - Stack Overflow

  Ensuring Non Uniqueness Using Exclude Using Gist Constraint

  18: F.8. btree_gist — GiST operator classes with B-tree behavior

  Tracking Reproducible Revisions in PostgreSQL Using RANGE Types

  ApplicationTimeProgress - PostgreSQL wiki

  Purchase Price Variance: What the Number Means and What AP

  Purchase Price Variance (PPV): Formula & Journal Entry | Gruvero

  PPV meaning: what purchase price variance tells you about your

  Purchase Price Variance (PPV) - LineNow

  Delivery costs variance and Purchase Price ... - SAP Community

  Purchase Price Variance (PPV): meaning and formula - Moss

  Purchase Price Variance: Formula, Example, and Analysis

  WIP, Variance Calculation & Settlement of Production Orders - Scribd

  LerianStudio repositories - GitHub

  Lerian Studio - GitHub

  gorules/zen-go: Open-source business rules engine for Go - GitHub

  gorules/editor: Open-source Rules Engine editor with Simulator

  What Is SuiteCommerce? Pricing, Pros & Cons (2026) - BrokenRubik

  NetSuite SuiteCommerce Pricing: Complete 2026 Cost Guide for E

  NetSuite Applications Suite - SuiteCommerce InStore (SCIS)

  Benefits of SuiteCommerce InStore in NetSuite 2026.1 for Retail

  Commerce Modules - Medusa Documentation

  Medusa v2 modules explained for decision makers - KVY TECH

  medusa js: Commerce Platform Guide - AnyGen

  MedusaJS: open-source commerce on Node.js explained

  Exploring Medusa 2.0 Commerce Modules | Rigby Blog

  corteza/README.md at 2026.9.x - GitHub

  5 GitHub repositories for e-commerce teams: setup and running costs

  vendurehq/vendure: Open-source headless commerce platform built

  Community-maintained plugins for Vendure - GitHub

  Best headless commerce platforms: 2026 comparison - Vendure

  Issues · inventree/InvenTree - GitHub

  [BUG] stock_account: Infinite recursion in Stock Valuation Report for

  [13.0] Wrong lot wise inventory Valuation with Costing Method - GitHub

  Valuation of stock movements and inventory operations - Odoo

  Stock Valuation Layer Usage - OCA Apps Store

  Inventory valuation configuration — Odoo saas-16.3 documentatie

  Double-Entry Inventory Management System in Odoo - Technaureus

  Multi-Currency ERP: Realized vs Unrealized FX Gains - ERPfm

  Multi Currency Accounting - ERPNext - Frappe Documentation

  Multicurrency Accounting Explained: A Guide - NetSuite

  Multi-currency - Realized Gains/Losses | Odoo Accounting - YouTube

  Domain-Driven Design Essentials Guide | PDF | Conceptual Model

  Deep Dive Domain-Driven Design & warum Modularisierung von

  (PDF) Modular design and custom development in ERP systems

  Modular ERP Architecture for Flexible Business Growth

  Modular Architecture: The Enterprise Blueprint for 2027 and Beyond

  CRM System Architecture: Design Patterns for Scalability

  Software Architecture Metamodel | Specy AI

  Composable Enterprise Architecture: A New Paradigm for Modular

  odoo/addons/stock_landed_costs/stock_landed_costs.py at master

  setup-temporal/README.md at main - GitHub

  CONTRIBUTING.md - temporalio/temporal - GitHub

  GitHub - temporalio/temporal: Temporal service

  temporalio/temporal-learning - GitHub

  A curated list of awesome Temporal libraries and resources. - GitHub

  schema.sql - temporalio/temporal · GitHub

  Work in Process (WIP) Inventory: Formula & Examples | Bizowie

  Real Production Cost! - Manufacturing - Frappe Forum

  Manufacturing Discussion - #27 by mkhoa94 - Stock/Inventory

  ERPNext Manufacturing Module: BOM & Work Orders - Data Value

  Standard Valuation Rate - Frappe Documentation

  Supporting Multiple Units of Measure with Distribution ERP - Aptean

  Dual Unit of Measure - Oracle Help Center

  Twenty CRM Features — Modern Open Source CRM Platform

  Key Features - Twenty Documentation

  Dynamics 365 CPQ vs Native Quoting: The 2026 Build-vs-Buy

  CPQ Implementation: The Complete Guide to a Successful Rollout

  Pricing Plans - Twenty Documentation

  Which datatype should be used for currency? - Stack Overflow

  Documentation: 19: 8.1. Numeric Types - PostgreSQL

  PostgreSQL NUMERIC Data Type - Neon

  PostgreSQL Data Types - Numeric, Text, and More - Prisma

  fifo · GitHub Topics

  Discussions - InvenTree - GitHub

  IVENTORY-FIFO-METHOD-Gudang-metode-Fifo - GitHub

  Discussions · GitHub - InvenTree

  How Inventories Work - Beancount Documentation

  A FIFO Compliant Inventory Management System · GitHub

  The Differences between Traditional and Event-based WIP and

  Modernizing finance without losing control: The subledger's role

  Optimized Create Accounting Orchestration for Multi-Ledger

  ERP migration: the new ledger on day one - Actuals

  dexie repositories - GitHub

  What is a good license for a software project template?

  Odoo Community vs Enterprise – what's the right choice for you?

  Odoo Community vs Enterprise – Welche Version ist die richtige für

  ERPNext Version 16: alle Neuerungen und der Umstieg

  ERPNext v16: New Features and Upgrade Guide - Auriga IT

  ERPNext v16 vs v15: Key Updates & Features | Indictrans

  Serial and batch selector | ERPNext v15 - YouTube

  Serial and Batch - Frappe Documentation

  v15 Serial and Batch Bundle - Stock Reconciliation broken for old

  Manage Reservations in Medusa Admin - Medusa Admin User Guide

  [Bug]: Confirming a claim or exchange without an outbound shipping

  Inventory and order management | Knowledge base - Medusa.js

  Apache OFBiz Developer Manual - ofbizextra

  Party Role Data Model : r/Database - Reddit

  Understanding Production Order Variance - Part 2 T

  The 4-Step Manufacturing Accounting Process Flow - GuzmanGray

  Manufacturing ERP Implementation: Financial Planning Guide - Wiss

  How to Set Up and Manage Perpetual Inventory System

  German Community - Frappe Forum

  Kassensicherheit 2026: TSE, KassenSichV und GoBD einfach erklärt

  Releases · moqui/moqui-framework - GitHub

  Extendable workflow engine for the Moqui Framework - GitHub

  Use Moqui Framework to build enterprise applications ... - GitHub

  The old Moqui Framework repository. For the latest see the ... - GitHub

  moqui-framework/AUTHORS at master - GitHub

  lerianstudio/midaz-mcp-server - NPM

  GitHub - LerianStudio/lerian-terraform-foundation

  GitHub - LerianStudio/midaz-sdk-golang: A Go client library for the

  Credit Note in ERPNext | Zikpro

  Sales / Purchase Return enhancements · Issue #3582 · frappe/erpnext

## Stage 2 (Persian)

این بررسی به‌عنوان بازبینی نقادانه (Stage 2) روی گزارش R23 انجام شده است. در این سند از تکرار مطالب گزارش اولیه خودداری شده و صرفاً بر راستی‌آزمایی منابع اصلی، استخراج شکاف‌های پرهزینه در افق ۱۲ تا ۲۴ ماه، بسته تصمیم‌گیری اجرایی و پرسش‌های نیازمند متخصص انسانی تمرکز شده است. (تاریخ راستی‌آزمایی: ۲۱ نوامبر ۲۰۲۶)

۱. جدول راستی‌آزمایی اعداد، تاریخ‌ها، آستانه‌ها و ادعاهای حقوقی (Fact-Check Audit)

در این جدول، ادعاهای کلیدی گزارش صرفاً بر اساس منابع اولیه و اسناد معتبر ۲۰۲۶ بررسی شده‌اند و واقعیت‌ها (Facts) کاملاً از توصیه‌ها تفکیک شده‌اند.

ادعا در گزارش R23	منبع اصلی / مرجع معتبر (URL)	تاریخ منبع	وضعیت و اصلاح دقیق
PostgreSQL 19 در سال ۲۰۲۶ در وضعیت «Beta 1» است و FOR PORTION OF را اضافه می‌کند.	PostgreSQL.org Official News و Neon PG 19 Docs	۱۹ نوامبر ۲۰۲۶ / ۸ سپتامبر ۲۰۲۶	CHANGED: نسخه PostgreSQL 19 در تاریخ ۱۹ نوامبر ۲۰۲۶ به‌صورت رسمی (GA) منتشر شده است و دیگر در فاز بتا نیست. پشتیبانی از UPDATE/DELETE ... FOR PORTION OF تایید می‌شود.
تاریخ دقیق پایان پشتیبانی (EOL) برای NetSuite POS و SCIS در مستندات افشا نشده است.	ERP Advisors Group و iVendNext	۴ ژوئن ۲۰۲۶ / ۲۶ اکتبر ۲۰۲۶	CHANGED: طبق گزارش شرکای رسمی NetSuite، بازنشستگی در فوریه ۲۰۲۶ اعلام شده و تاریخ پایان پشتیبانی ۳۱ ژانویه ۲۰۲۹ است (فروش به مشتریان جدید متوقف شده است). (نکته: این تاریخ از سوی شرکا گزارش شده و در صفحه عمومی اوراکل منتشر نشده است.)
نگهداری ۱۰ ساله اسناد POS و رسیدها تحت AO/GoBD آلمان.	Deutsches-Gewerbe و Receipt4s	۶ نوامبر ۲۰۲۶ / ۳۰ ژوئیه ۲۰۲۶	CHANGED: طبق قانون BEG IV (اجرا از ۱ ژانویه ۲۰۲۵)، مدت نگهداری اسناد و رسیدهای حسابداری (Buchungsbelege) از ۱۰ سال به ۸ سال کاهش یافته است. مدت ۱۰ سال فقط برای دفاتر اصلی، صورت‌های مالی و Kassenbuch (ماده ۱۴۷ AO) پابرجاست. همچنین دولت آلمان در ۱۶ ژوئیه ۲۰۲۶ طرح پیشنهادی افزایش آن به ۱۵ سال را مطرح کرده که هنوز قانون نشده است.
فرانسه (E-Invoicing): تعلیق خودکار جریمه‌ها تا ۳۱ دسامبر ۲۰۲۶ (پس از اجرای ۱ سپتامبر ۲۰۲۶ برای شرکت‌های بزرگ/متوسط و ۱ سپتامبر ۲۰۲۷ برای SMEها).	SEEBURGER Blog	۱۷ سپتامبر ۲۰۲۶	CHANGED: تعلیق خودکار و عمومی (Grace Period) وجود ندارد. الزامات قانونی از ۱ سپتامبر ۲۰۲۶ لازم‌الاجراست و «مدارای جریمه» فقط به‌صورت مشروط شامل شرکت‌هایی می‌شود که حسن نیت، پروژه فعال و مستندات رفع اشکال داشته باشند. تاریخ ۱ سپتامبر ۲۰۲۷ برای SMEها تایید می‌شود.
آلمان (E-Invoicing): دریافت الزامی از ۱ ژانویه ۲۰۲۵؛ صدور الزامی از ۱ ژانویه ۲۰۲۷ (گردش مالی بیش از ۸۰۰٬۰۰۰ یورو در ۲۰۲۶) و ۱ ژانویه ۲۰۲۸ برای همه، با فرمت XRechnung یا ZUGFeRD 2.2+.	Docshero (BMF Guide)	۸ نوامبر ۲۰۲۶	CHANGED (جزئی): تمام تاریخ‌ها و آستانه ۸۰۰٬۰۰۰ یورو (ماده ۲۷ پاراگراف ۳۸ UStG) تایید می‌شوند، اما نسخه مجاز ZUGFeRD از نسخه 2.0.1 به بالا (به‌جز پروفایل‌های MINIMUM و BASIC-WL) پذیرفته است، نه صرفاً 2.2+.
فرانسه (POS / ISCA / NF525): بازگشت خوداظهاری تولیدکننده نرم‌افزار (Self-Certification) در قانون مالی ۲۰۲۶.	fiskaly France Compliance	۱۴ ژوئیه ۲۰۲۶	VERIFIED: ماده ۱۲۵ قانون مالی ۲۰۲۶ فرانسه (۲۱ فوریه ۲۰۲۶، تایید BOFiP در ۲۵ مارس ۲۰۲۶) خوداظهاری فروشنده را در کنار گواهی NF525/LNE بازگرداند و مهلت ۱ سپتامبر ۲۰۲۶ لغو شد؛ اما جریمه فروشنده متخلف تا ۱۵٪ درآمد و برای کسب‌وکار ۷٬۵۰۰ یورو به ازای هر صندوق است.
لهستان (KSeF): اجرای الزامی در فوریه و آوریل ۲۰۲۶.	KSeF 2026 Legal Guide	۱۱ آوریل ۲۰۲۶	VERIFIED: از ۱ فوریه ۲۰۲۶ برای شرکت‌های با فروش بیش از ۲۰۰ میلیون زلوتی در ۲۰۲۴ و از ۱ آوریل ۲۰۲۶ برای سایر مودیان اجرا شده است (با جریمه تا ۱۰۰٪ مبلغ VAT و ریسک از دست رفتن حق کسر مالیات برای خریدار).
آلمان (VAT رستوران‌ها): بازگشت به ۷٪ روی غذا در سال ۲۰۲۶.	Grant Thornton Germany	۲۲ ژانویه ۲۰۲۶	VERIFIED: از ۱ ژانویه ۲۰۲۶ (مصوب ۱۹ دسامبر ۲۰۲۵ در بوندسرات)، مالیات غذا ۷٪ و نوشیدنی‌ها همچنان ۱۹٪ است.
آلمان (ELSTER POS Notification): فعال از ۱ ژانویه ۲۰۲۵.	KassenSichV.net و Handwerksblatt	۲۰ نوامبر ۲۰۲۶	VERIFIED: سامانه ثبت از ۱ ژانویه ۲۰۲۵ فعال شد (مهلت صندوق‌های قبلی ۳۱ ژوئیه ۲۰۲۵ بود و صندوق‌های جدید ظرف ۱ ماه باید ثبت شوند).
آمریکا (FDA FSMA Section 204): تمدید ۳۰ ماهه از ۲۰ ژانویه ۲۰۲۶ به ۲۰ ژوئیه ۲۰۲۸ به دستور کنگره در Continuing Appropriations Act of 2026.	FDA Official PDF و iFactory AI	۲۰ ژوئیه ۲۰۲۶	VERIFIED: تاریخ اجرای الزامی ۲۰ ژوئیه ۲۰۲۸ تایید می‌شود، ضمن آنکه خرده‌فروشان بزرگ مانند Walmart الزامات ردیابی را از اوت ۲۰۲۵ به‌صورت قراردادی اجرا کرده‌اند.
مقررات EU FIC 1169/2011 (آلرژن‌ها و اطلاعات تغذیه‌ای) و ممنوعیت LIFO در IFRS / IAS 2.	EUR-Lex 1169/2011 و KPMG IFRS vs US GAAP	نسخه تلفیقی ۲۰۲۵ / ۲۰۲۶	VERIFIED: هر دو کاملاً تایید می‌شوند (۱۴ آلرژن اصلی در EU 1169/2011 و ممنوعیت کامل LIFO در IAS 2).
Dynamics 365 Business Central: بیش از ۵۵٬۰۰۰ مشتری؛ قیمت آمریکا ۸۰ دلار (Essentials) و ۱۱۰ دلار (Premium) سالانه در اکتبر ۲۰۲۶.	Flectic Pricing Analysis و TechImplement	۸ نوامبر ۲۰۲۶	VERIFIED: افزایش قیمت مایکروسافت از ۱ نوامبر ۲۰۲۵ اعمال شد و قیمت لیست آمریکا در اکتبر ۲۰۲۶ دقیقاً ۸۰ و ۱۱۰ دلار (و Team Members معادل ۸ دلار) با ۵۵٬۰۰۰ مشتری است.
Oracle NetSuite: بیش از ۴۴٬۰۰۰ مشتری ابری.	NetSuite Newsroom	۲۶ اکتبر ۲۰۲۶	VERIFIED: در بیانیه رسمی اوراکل/نت‌سوئیت تایید شده است.
Odoo 20: افزایش ۲۰٪ پلن Custom در ۲۰۲۶، حذف BYOK و اعتبار AI به مبلغ ۱ یورو/اعتبار.	Pantalytics Odoo 20 Analysis و iVentureTeam	۳۰ سپتامبر ۲۰۲۶ / ۲۸ اکتبر ۲۰۲۶	VERIFIED (با یک نکته حیاتی جاافتاده): انتشار ۲۴ سپتامبر ۲۰۲۶، افزایش ۲۰٪ تا ۳۱٪ پلن Custom (آلمان ۴۴٫۹۰ یورو، آمریکا ۶۱ دلار) و ۱ یورو برای هر اعتبار AI تایید می‌شود. نکته جاافتاده: Odoo 20 مدل «Light User» به مبلغ ۷٫۹۰ یورو/ماه را برای کارمندان بدون لاگین نیز اضافه کرده است.
Odoo 19 Issue #231659 (خطای ارزیابی ارزی EUR به QAR به نسبت ۱:۱).	GitHub odoo/odoo#231659	۱۵ اکتبر ۲۰۲۵	VERIFIED: باگ گزارش‌شده واقعی و همچنان در مخزن رسمی قابل مشاهده است.
Twenty CRM: لایسنس AGPL-3.0 با Application Exception (عدم شمول تغییرات هسته) + پلن‌های ابری ۹ دلار Pro و ۳۹ دلار Org.	GitHub twenty/LICENSE و Twenty Pricing	۲۰۲۶	VERIFIED: متن بند ۴ لایسنس و قیمت‌گذاری ۹ دلار Pro / ۳۹ دلار Org / ۵۰٬۰۰۰ دلار سالانه Enterprise دقیقاً تایید می‌شود.
ERPNext v16 / v17: لایسنس GPL-3.0؛ حذف CRM داخلی در v17 و ارجاع به Frappe CRM (AGPL-3.0).	GitHub frappe/erpnext#50722 و OpenSourceCRMs	۲۴ نوامبر ۲۰۲۵ / ۱۴ اکتبر ۲۰۲۶	VERIFIED: نگهدارندگان رسمی تایید کرده‌اند که ماژول CRM منسوخ شده و تا نسخه ۱۷ کاملاً حذف می‌شود.
لایسنس ابزارهای مجاز: Medusa v2 (MIT core)، Formance Ledger (MIT بازگردانده‌شده در v2.4)، Blnk (Apache-2.0)، TigerBeetle (Apache-2.0)، GoRules ZEN (MIT)، Temporal (MIT)، Vendure Core (GPLv3).	Medusa Docs، Formance GitHub، Blnk GitHub، TigerBeetle، ZEN، Temporal	اکتبر–نوامبر ۲۰۲۶	VERIFIED: تمامی لایسنس‌ها در مخازن اصلی تایید شدند. (نکته: بررسی لایسنس دقیق Mustangproject، Typst و Dexie.js و Lerian Midaz از فایل LICENSE مستقیم در این نوبت استعلام نشد و پیش از اضافه شدن به CI باید در اسکنر SCA قفل شود.)
بنچمارک Now-Next برای PostgreSQL 17 (سربار ۰٫۰۱ms برای RLS و تاخیر ۲ms / ۷۷ms / ۲۴۱ms برای ۱۰۰ / ۱۰۰۰ / ۳۰۰۰ پارتیشن).	جستجوی مستقیم منبع Now-Next	—	UNVERIFIABLE: در جستجوی آزاد منبع اصلی این بنچمارک عددی دقیق یافت نشد. اگرچه اصل فنی افت کارایی با افزایش تعداد پارتیشن و کم‌هزینه بودن RLS با ایندکس ترکیبی (زیر ۱٪ سربار) توسط منابع مستقل تایید می‌شود، اما اعداد دقیق ۰٫۰۱ms و ۲۴۱ms باید پیش از استناد رسمی با بنچمارک داخلی تیم روی سخت‌افزار خودتان تایید شوند.

۲. آنچه گزارش از قلم انداخته و در ۱۲ تا ۲۴ ماه آینده به ما ضربه می‌زند (۱۲ شکاف حیاتی)

1. تعارض حقوقی GDPR (حق فراموشی / Erasure) با دفترکل غیرقابل‌تغییر (Immutable Ledger) و قوانین GoBD:
  ⚬ چرا حیاتی است: اگر اطلاعات هویتی مشتریان (PII) را مستقیم داخل جداول غیرقابل‌تغییر فاکتورها، دفترکل یا اسناد بایگانی‌شده ذخیره کنید، با اولین درخواست حذف GDPR یا باید قانون نگهداری ۸ تا ۱۰ ساله مالیاتی را نقض کنید یا قانون GDPR را. باید از روز اول الگوی PII Vault / Crypto-shredding (جداسازی داده‌های شخصی با کلید رمزنگاری قابل امحا) پیاده شود.
2. تناقض فنی «POS آفلاین» با «Cloud-TSE آلمان» (KassenSichV):
  ⚬ چرا حیاتی است: گزارش همزمان بر «POS کاملاً آفلاین با Dexie.js» و «Cloud-TSE تجاری مثل fiskaly» تاکید کرده است. در آلمان وقتی اینترنت قطع می‌شود، Cloud-TSE قادر به امضای آنی تراکنش نیست و قوانین KassenSichV برای ثبت حالت خرابی (Ausfallmeldung) و چاپ رسید بدون امضای معتبر سخت‌گیرانه است. برای آفلاین واقعی در خرده‌فروشی آلمان، باید از روز اول معماری Hybrid/Local USB-TSE یا LAN-TSE و مدیریت وضعیت خرابی را در آداپتور POS ببینید.
3. گواهی‌نامه‌های اعتماد بازار اروپا (IDW PS 880 / GoBD Verfahrensdokumentation و SOC 2 / ISO 27001):
  ⚬ چرا حیاتی است: در آلمان، حتی اگر نرم‌افزار شما از نظر فنی بی‌نقص باشد، مشاوران مالیاتی (Steuerberater) تا زمانی که مستندات فرآیندی (Verfahrensdokumentation) و گواهی تطابق نرم‌افزاری (مانند IDW PS 880) نبینند، به SMEها اجازه مهاجرت نمی‌دهند. این موضوع چرخه فروش را ۶ تا ۱۲ ماه قفل می‌کند.
4. معماری Dual-Database (PostgreSQL + Formance/Blnk/TigerBeetle) و کابوس Split-Brain:
  ⚬ چرا حیاتی است: گزارش استفاده از Formance یا Blnk را به‌عنوان گزینه قوی GL پیشنهاد داده، اما هزینه عملیاتی «عدم امکان JOIN مستقیم بین زیرسیستم‌های ERP در Postgres و دفترکل خارجی»، مشکل تراکنش‌های توزیع‌شده، و پیچیدگی بک‌آپ هماهنگ (Consistent Snapshot) بین دو دیتابیس را نادیده گرفته است. در ۱۲ تا ۲۴ ماه اول، این پیچیدگی سرعت تیم را به‌شدت کاهش می‌دهد.
5. شماره‌گذاری اسناد بدون شکاف (Gapless Sequential Numbering) تحت همزمانی بالا:
  ⚬ چرا حیاتی است: قوانین مالیاتی اروپا (از جمله آلمان و فرانسه) برای شماره فاکتورها و اسناد حسابداری، توالی بدون شکاف و غیرقابل‌تغییر می‌خواهند. استفاده از SERIAL/IDENTITY در PostgreSQL در صورت Rollback شکاف ایجاد می‌کند، و استفاده از قفل روی یک ردیف جدول (SELECT ... FOR UPDATE) در ساعت اوج فروش POS یا صدور فاکتور دسته‌ای باعث گلوگاه شدید (Lock Contention) می‌شود.
6. بازیابی انتخابی یک Tenant (Per-Tenant Point-in-Time Recovery):
  ⚬ چرا حیاتی است: در معماری Shared-Table با RLS، اگر یک مشتری مهم به‌اشتباه کل لیست قیمت یا مشتریان خود را دستکاری کند و درخواست بازگشت به ۲ ساعت قبل را بدهد، نمی‌توان کل دیتابیس را برای بقیه مشتریان به عقب برگرداند. نبود استراتژی Logical Backup / Shadow Table یا Event Replay برای بازیابی تک‌مشتری، در سال اول باعث بحران SLA می‌شود.
7. مهاجرت داده از سیستم‌های قدیمی (Legacy Data Migration & Cutover):
  ⚬ چرا حیاتی است: در دنیای واقعی ERP، مشتریان با فایل‌های اکسل کثیف، تکراری، لایه‌های موجودی نامنطبق و مانده‌های باز وارد می‌شوند. گزارش هیچ ابزاری برای Dry-Run Import، تطبیق مانده‌های افتتاحیه (Opening Balance Cutoff) و انتقال لایه‌های FIFO باز ندیده است؛ این بزرگ‌ترین عامل شکست پیاده‌سازی ERP در SMEهاست.
8. اتصال بانکی اروپا (PSD2 / Open Banking / EBICS / FinTS / SEPA Pain.001 & CAMT.053):
  ⚬ چرا حیاتی است: گزارش در فاز ۳ به «ایمپورت و مغایرت‌گیری بانکی» اشاره کرده، اما در اروپا اتصال خودکار به بانک‌ها بدون مجوز AISP/PISP ممکن نیست و وابسته به واسط‌های پرهزینه (مانند finAPI، Tink یا GoCardless) و فرمت‌های ISO 20022 (CAMT.053 / PAIN.001) است.
9. تضاد بارهای کاری OLTP و OLAP (گزارش‌گیری مالی سنگین و MRP روی دیتابیس تراکنشی):
  ⚬ چرا حیاتی است: اجرای همزمان تراز آزمایشی چندشرکتی، گزارش ارزش موجودی در تاریخ گذشته (As-of Valuation) و محاسبات MRP روی همان کلاستر PostgreSQL که سفارش‌ها و POS را ثبت می‌کند، در ماه ۱۲ تا ۱۸ باعث افت شدید زمان پاسخ‌دهی (Latency Spikes) می‌شود. جداسازی Read Replica یا لایه OLAP (مانند DuckDB/ClickHouse) دیده نشده است.
10. امنیت و حاکمیت لایه AI / MCP (Prompt Injection و کنترل هزینه متغیر):
  ⚬ چرا حیاتی است: گزارش در فاز ۱ یک سرور MCP برای عامل‌های هوش مصنوعی پیشنهاد کرده است، اما مدل‌های تهدید (مانند Prompt Injection در ایمیل‌های همگام‌سازی‌شده که منجر به صدور پیش‌فاکتور با تخفیف ۹۹٪ شود)، الزام تایید انسانی (Human-in-the-Loop) برای عملیات مالی، و مکانیزم Metering/Billing برای کنترل هزینه‌های متغیر (LLM، APIهای مالیاتی، فضای آرشیو ۱۰ ساله) کاملاً غایب هستند.
11. مسئولیت حقوقی فروشنده در خوداظهاری فرانسه و ریسک توقف کسب‌وکار در KSeF:
  ⚬ چرا حیاتی است: اگر در فرانسه مسیر خوداظهاری (Self-Certification) را انتخاب کنید، ریسک حقوقی و جریمه تا ۱۵٪ درآمد مستقیماً متوجه شرکت سازنده نرم‌افزار است. همچنین در سیستم‌های Clearance مثل KSeF لهستان، قطعی ارتباط یا خطای اعتبارسنجی به معنای عدم امکان صدور فاکتور قانونی و جریمه تا ۱۰۰٪ VAT است؛ نیاز به طراحی دقیق Offline Contingency Mode دارد.
12. عمق واقعی بومی‌سازی (Localization) فراتر از ترجمه:
  ⚬ چرا حیاتی است: گزارش روی ۳ بازار بسیار متفاوت (آلمان، فرانسه، لهستان + FSMA آمریکا) به‌طور همزمان دست گذاشته است. هر کشور چارت حساب استاندارد (مثلاً SKR03/SKR04 در آلمان، PCG در فرانسه)، فرمت خروجی حسابرسی (GoBD/GDPdU در آلمان، FEC در فرانسه) و قوانین مالیات بر ارزش افزوده خاص (مانند Reverse Charge درون‌اتحادیه‌ای، OSS، و تفاوت کوپن تک‌منظوره و چندمنظوره) دارد. ورود همزمان به چند کشور، تیم محصول را فلج می‌کند.

۳. بسته تصمیم‌گیری اجرایی (DECISION PACK)

(تفکیک شفاف: موارد بخش ۱ و ارجاعات حقوقی بالا واقعیت‌های تاییدشده هستند؛ اما برآوردهای هزینه، زمان، تلاش مهندسی و توصیه‌های زیر تحلیل و برآورد مهندسی برای تصمیم‌گیری مدیریتی هستند.)

مقایسه گزینه‌های معماری

معیار	گزینه A: معماری گزارش R23 (Postgres + دفترکل خارجی Formance/Blnk + ورود چندکشوری)	گزینه B (پیشنهادی): Modular Monolith خالص روی PostgreSQL 19 + دفترکل بومی Append-Only + تمرکز یک بازار (DACH)	گزینه C: هسته Medusa v2 (MIT) + ماژول‌های اختصاصی CRM/ERP روی Postgres
خلاصه معماری	ساخت هسته ERP در Postgres + دفترکل جداگانه (Formance/Blnk) + Temporal + ZEN + پوشش همزمان آلمان/فرانسه/لهستان/غذا/POS.	تک‌دیتابیس PostgreSQL 19 (با WITHOUT OVERLAPS و FOR PORTION OF بومی) + دفترکل Append-Only در همان Postgres + Temporal + ZEN + Typst + Mustangproject؛ تمرکز اولیه فقط روی یک کشور (آلمان/DACH).	استفاده از Medusa v2 برای کاتالوگ/سفارش/قیمت + ساخت CRM، انبارداری دائمی، خرید و حسابداری در کنار آن.
هزینه یک‌باره (توسعه ۱۸ ماهه - برآوردی)	بسیار بالا: ~۶۵۰ تا ۹۵۰ هزار یورو (تیم ۶ تا ۸ نفره + مشاوران مالیاتی چندکشوری + زیرساخت دوگانه).	بهینه و کنترل‌شده: ~۳۸۰ تا ۵۵۰ هزار یورو (تیم ۴ تا ۶ نفره متمرکز + مشاور مالیاتی یک کشور).	متوسط رو به بالا: ~۴۵۰ تا ۶۵۰ هزار یورو (صرفه‌جویی ۳ ماهه در OMS، اما هزینه سنگین دور زدن نبود Multi-Tenancy و باگ‌های v2 در Medusa).
هزینه ماهانه زیرساخت و سرویس‌ها (برآوردی برای ۵۰ تا ۲۰۰ مشتری SME)	۲٬۵۰۰ تا ۵٬۵۰۰ یورو/ماه (کلاستر Postgres + کلاستر Ledger دوم + Temporal + سرویس‌های TSE/PA چندکشوری).	۱٬۲۰۰ تا ۲٬۸۰۰ یورو/ماه (کلاستر Postgres 19 HA + Read Replica + Redis + Temporal + fiskaly/Peppol بر حسب مصرف).	۱٬۸۰۰ تا ۳٬۵۰۰ یورو/ماه (مشابه گزینه B + سربار سرویس‌های Node/Medusa و لایه همگام‌سازی).
میزان تلاش (Effort)	بسیار زیاد (ریسک بالای پخش‌شدن تمرکز و تاخیر درآمدزایی).	متوسط-زیاد، اما با مسیر نقدینگی سریع‌تر (درآمدزایی در ماه ۳ تا ۴).	زیاد در میان‌مدت (بدهی فنی بالا هنگام افزودن Multi-Company و Perpetual Costing).
برگشت‌پذیری (Reversibility)	پایین: تغییر دیتابیس دفترکل یا انصراف از تعهدات چندکشوری پس از جذب مشتری بسیار پرهزینه است.	بالا: چون هسته بر پایه Outbox و Event-Driven است، در آینده اگر حجم تراکنش از سقف Postgres عبور کرد، انتقال Sink دفترکل به TigerBeetle/Formance بدون تغییر دامنه ممکن است.	پایین: وابستگی ساختاری به مدل داده و چرخه آپگرید Medusa v2، جدا شدن بعدی را سخت می‌کند.

توصیه نهایی (Recommendation)

گزینه B را انتخاب کنید و دو اصلاح فوری روی گزارش R23 اعمال کنید:

1. حذف دیتابیس دفترکل دوم در ۱۸ ماه اول: به‌جای افزودن Formance یا Blnk به‌عنوان یک دیتابیس مستقل، دفترکل Append-Only را درون PostgreSQL 19 (با تریگرهای جلوگیری از UPDATE/DELETE، قید توازن DEBIT = CREDIT و Outbox) پیاده کنید. این کار تراکنش‌های اتمیک بین زیرسیستم انبار/فروش و دفترکل را تضمین کرده و پیچیدگی عملیاتی را نصف می‌کند.
2. تمرکز جغرافیایی و عمودی (Wedge Strategy): از ساخت همزمان انطباق آلمان، فرانسه، لهستان و FSMA آمریکا در فازهای اولیه خودداری کنید. بازار اول را روی آلمان (DACH) با تمرکز بر توزیع B2B و تولید سبک/غذایی قفل کنید (جایی که الزام e-invoicing سال ۲۰۲۷ برای شرکت‌های بالای ۸۰۰ هزار یورو و افزایش قیمت ۲۰٪ Odoo 20 یک پنجره فرصت واقعی ایجاد کرده است) و POS را تا زمان تثبیت درآمد هسته ERP به تعویق بیندازید یا با یک شریک سخت‌افزاری/TSE محلی محدود کنید.

نقشه راه اقدام (Action Plan)

⚬ این ماه (ماه ۱ — فاز ۰ اصلاح‌شده):
  ⚬ استقرار PostgreSQL 19 با RLS اجباری (FORCE ROW LEVEL SECURITY)، کلیدهای ترکیبی (tenant_id, id)، و تست خودکار نشت داده پشت PgBouncer با ۲۰۰ کلاینت همزمان.
  ⚬ طراحی Schema نهایی برای ۷ اصل غیرقابل‌بازگشت + جدول PII Vault (برای GDPR) + مکانیزم Gapless Sequence با قفل کوتاه‌مدت در سطح (company_id, doc_type, fiscal_year).
  ⚬ راه‌اندازی اسکنر خودکار SCA/SBOM در CI با لیست سفید لایسنس‌ها (MIT، Apache-2.0، BSD، ISC، CC0).
  ⚬ اجرای بنچمارک داخلی برای تایید سرعت RLS و قفل‌های شماره‌گذاری روی سخت‌افزار واقعی شما.
⚬ ماه ۳ (پایان فصل اول):
  ⚬ عرضه نسخه تجاری CRM + CPQ خطی (Line-Item Quoting) با لیست قیمت‌های تاریخ‌دار (با استفاده از WITHOUT OVERLAPS و FOR PORTION OF در PG 19)، خروجی PDF با Typst، و اتصال ایمیل/تقویم.
  ⚬ جذب ۵ تا ۱۰ مشتری پایلوت B2B و تست فرآیند مهاجرت داده (Import Dry-Run).
  ⚬ تعلیق هرگونه نوشتار مالی خودکار توسط MCP Server (فقط دسترسی Read-Only یا Draft با تایید انسانی).
⚬ ماه ۶ (پایان نیم‌سال اول):
  ⚬ فعال‌سازی مدیریت سفارش (OMS)، RMA و صدور/دریافت e-Invoice آلمان (XRechnung و ZUGFeRD 2.0.1+ با Mustangproject) و خروجی استاندارد DATEV برای مشاوران مالیاتی.
  ⚬ راه‌اندازی Read Replica برای جداسازی گزارش‌ها از تراکنش‌های عملیاتی و پیاده‌سازی ابزار بازیابی انتخابی تک‌مشتری (Per-Tenant Export/Restore).
⚬ ماه ۱۲ (پایان سال اول):
  ⚬ فعال‌سازی کامل انبارداری چندانباره، لات/FEFO، Catch-Weight (دو واحدی)، خرید و تطابق ۳ طرفه (با رسید جزئی) و موتور بهای تمام‌شده دائمی (FIFO/AVCO) + تقسیم Landed Cost در دوره جاری با دفترکل Append-Only داخلی.
  ⚬ آغاز فرآیند ممیزی GoBD / Verfahrensdokumentation با یک حسابرس آلمانی و شروع فاز تولید (BOM/فرمولاسیون و WIP).

محرک‌های بازنگری (Revisit Triggers)

در صورت وقوع هر یک از موارد زیر، باید تصمیم معماری فوراً بازبینی شود:

1. عبور حجم نوشتار دفترکل از ۵٬۰۰۰ تراکنش در ثانیه (TPS) به‌صورت پایدار یا رشد جدول Journal Lines فراتر از ۱ میلیارد ردیف: در این نقطه، استخراج دفترکل به TigerBeetle یا پارتیشن‌بندی زمانی (created_at) در PostgreSQL الزامی می‌شود.
2. تصویب نهایی قانون افزایش مدت نگهداری اسناد آلمان از ۸/۱۰ سال به ۱۵ سال (بر اساس طرح ژوئیه ۲۰۲۶ دولت آلمان): نیازمند بازنگری در سیاست‌های Cold Storage (S3 Glacier / WORM) و قیمت‌گذاری پلن‌هاست.
3. رسیدن سهم تقاضای مشتریان برای POS آفلاین آلمان به بیش از ۳۰٪ پایپ‌لاین فروش: در این نقطه باید از Cloud-TSE صرف عبور کرده و لایه Local/Hardware TSE را در آداپتور POS پیاده‌سازی کنید.
4. تغییر لایسنس هر یک از کتابخانه‌های کلیدی (مانند GoRules ZEN یا Formance) در نسخه‌های آتی: اسکنر CI باید آپگرید را متوقف کرده و تیم تصمیم بگیرد نسخه قبلی را Pin کند یا جایگزین بسازد.

۴. پرسش‌های باز نیازمند متخصص انسانی (به‌همراه پیش‌فرض پیشنهادی)

پرسش باز	متخصص مورد نیاز	پیش‌فرض پیشنهادی ما (Default Choice) تا زمان دریافت پاسخ رسمی
۱. مرز دقیق حقوقی Crypto-shredding / حذف PII مشتریان در اسناد مالیاتی بایگانی‌شده (تعارض GDPR و ماده ۱۴۷ AO / GoBD) چیست؟	وکیل حفاظت از داده (DPO) + مشاور مالیاتی آلمان (Steuerberater)	نگه‌داشتن PII در جدول جداگانه با کلید رمز اختصاصی هر Party و ذخیره صرفاً Snapshot حداقلی الزامیِ قانونی (نام حقوقی و شناسه مالیاتی) روی سند فاکتور، بدون ایمیل/تلفن شخصی.
۲. برای بازار آلمان، آیا دریافت گواهی IDW PS 880 برای فروش به SMEها ضروری است یا ارائه GoBD Verfahrensdokumentation آماده به همراه خروجی DATEV در سال اول کفایت می‌کند؟	حسابرس رسمی آلمانی (Wirtschaftsprüfer)	در ۱۲ ماه اول: ارائه خروجی استاندارد DATEV + پکیج کامل GoBD Verfahrensdokumentation. برنامه‌ریزی برای ممیزی رسمی IDW PS 880 پس از رسیدن به ۵۰ مشتری پولی.
۳. در صورت ورود به بازار فرانسه (سال دوم)، آیا ریسک حقوقی خوداظهاری (تا ۱۵٪ جریمه درآمد) قابل پوشش با بیمه مسئولیت است یا باید مستقیماً گواهی NF525/LNE اخذ شود؟	وکیل تجاری و مالیاتی فرانسه	برای جلوگیری از ریسک ۱۵٪ درآمد، استفاده از یک Middleware تاییدشده (مانند fiskaly که زیرساخت مطابق با LNE/InfoCert می‌دهد) و در صورت عبور فروش فرانسه از آستانه مشخص، اخذ گواهی مستقل NF525.
۴. ساختار حسابرسی و قفل‌گذاری شماره اسناد (Gapless Sequences) در حالت Multi-Company و هنگام صدور فاکتورهای همزمان از POS و B2B چگونه باید تعریف شود تا در ممیزی مالیاتی رد نشود؟	مشاور مالیاتی / حسابرس ERP	تعریف سری‌های شماره‌گذاری مجزا (Number Ranges) به ازای هر ترکیب (company_id, doc_type, channel, fiscal_year) تا صندوق‌های POS و فروش B2B روی یک قفل مشترک با هم برخورد نکنند.
۵. آیا استفاده از Mustangproject (جاوا) به‌عنوان Sidecar برای تولید ZUGFeRD/XRechnung، بار نگهداری JVM را توجیه می‌کند یا خرید API تجاری e-Invoicing (مانند Storecove/Billit/fiskaly) به‌صرفه‌تر است؟	معمار ارشد نرم‌افزار (Principal Architect)	برای تولید و اعتبارسنجی XML/PDF (ساختار EN 16931)، اجرای Mustangproject به‌صورت کانتینر Sidecar ایزوله و سبک (بدون هزینه به ازای هر فاکتور)؛ و فقط برای ارسال شبکه‌ای (Peppol Access Point / PA فرانسه) استفاده از API تجاری.
