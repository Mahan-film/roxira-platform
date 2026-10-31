Product Strategy and System Architecture for Roxira: A Modular, Agentic Accounting and ERP Platform for Iran and Global Markets

1. Competitive Benchmark and Strategic Positioning

1.1 Iranian Accounting and ERP Landscape: Facts vs. Vendor Claims

The Iranian financial software market is bifurcated between legacy Windows-first desktop or client-server incumbents and nascent cloud-native challengers. Market structure is dominated by System Group (Hamkaran System), which segments the domestic economy across three distinct tiers: enterprise organizations via Rahkaran, small-to-medium corporations via Sepidar System Asia (established in 1387 SH / 2008 CE), and retail micro-businesses via Dasht. On the retail and guild (اصناف) front, Holoo Information Technology Group commands an installed base of over 1 million businesses across 30 specialized guild categories and more than 97 software products and add-ons. Secondary contenders—including Mahak, Parmis, Fardad, Shaygan System, Tadbir, Payvast, Parsian, Mantigh, Gheyas, Mizan, and Nosa—compete across fragmented vertical niches. Meanwhile, cloud-native entrants such as Hesabfa (positioned for remote teams and freelancers), Moj (offering a freemium entry tier), and Abrak (an Iranian localization layer built atop Odoo 19) have begun challenging the traditional desktop paradigm.

Separating empirical operational facts from vendor marketing claims reveals acute structural vulnerabilities across Iranian incumbents. While legacy vendors heavily market "cloud" (ابری) editions, technical documentation confirms that most legacy offerings rely on Windows client binaries, local Microsoft SQL Server instances, hardware dongles (قفل سخت‌افزاری) that cause severe operational disruption when lost, or rudimentary manual and scheduled file backups uploaded to third-party consumer storage like Dropbox. Even web-bridged application programming interfaces (APIs)—such as the Holoo APEX Cloud Web Service—are sold as separate add-on kits priced at 5,000,000 Tomans (50,000,000 Rials) that require manual installation and parameter configuration.

Incumbent marketing frequently crosses into unverified hyperbole. Retail listings for Holoo Supermarket editions (codes 81847 and 81844, priced at 69,700,000 and 61,700,000 Tomans respectively) claim capabilities such as "3D AI barcode scanners scanning 500 items in 7 seconds with automatic discount/expiration/weight detection from photos," "live RFID aisle scanners reading an entire aisle in 3 seconds," "8K second monitor support with 360-degree ads," and "512-bit cloud backup every 5 minutes with 15-second disaster recovery". In actual operational practice, core workflows—such as database backup restoration, seasonal tax file generation, and social security diskette preparation—remain manual, brittle, and dependent on Windows-specific file paths and system locale configurations. Furthermore, independent evaluations of mid-tier Iranian accounting packages highlight persistent structural bugs in inventory sub-ledgers, cost-of-goods-sold (COGS) calculations, and profit reporting (as documented in Baran and Rafa 8), alongside steep annual support renewal fees and rigid complexity that alienates small businesses (as noted in Sepidar, Fardad, Tadbir, and Payvast). Legacy Iranian vendors monetize through steep upfront perpetual or annual bundle licenses, per-seat or per-dongle fees, and mandatory in-person demos. Full Sepidar corporate bundles reach list prices of 1,783,000,000 Rials (178,300,000 Tomans before package discounts), while specialized Sepidar and Fardad configurations average 84,546,000 Tomans and 73,865,000 Tomans respectively.

http://googleusercontent.com/visual_element_0

1.2 Global ERP and AI Accounting Startups Benchmark

Internationally, the accounting and ERP market has evolved across three architectural generations. The first generation comprises cloud accounting incumbents—specifically QuickBooks, Xero, Sage Intacct, and Zoho Books—which excel at core double-entry bookkeeping, bank feeds, and small-business invoicing, but lack native multi-level manufacturing, localized Iranian statutory compliance, or embedded agentic execution without expensive third-party middleware. The second generation consists of monolithic and modular suites led by Oracle NetSuite, Odoo, and ERPNext. NetSuite dominates the mid-market ERP tier with rigorous financial controls, serving as the primary integration target for autonomous AI layers. Odoo and ERPNext provide open-core and open-source modular breadth, with ERPNext v15 and v16 offering particularly strong multi-level Bill of Materials (BOM), Work Order, Job Card, and perpetual inventory valuation capabilities, while Odoo serves as the foundation for Iranian localizations like Abrak. However, both Odoo and ERPNext rely on monolithic Python/ORM architectures where deep tenant customization frequently introduces schema fragility and upgrade debt.

The third generation consists of AI-native accounting challengers—including Vic.ai, Numeric, Trullion, Tabs, Ramp, and Brex—that target high-friction operational bottlenecks rather than building general-purpose chatbots. Vic.ai focuses on autonomous Accounts Payable (AP), utilizing models trained on 500 million to over 1 billion invoices to execute header and line extraction, general ledger (GL) coding, two-way and three-way Purchase Order (PO) matching, and approval routing. While vendor marketing claims 97–99% AI accuracy and up to 355% full-time employee (FTE) processing capacity gains, independent industry synthesis indicates that real-world touch-free processing rates settle in the 80–90%+ range once the model has learned a tenant's vendor and coding patterns, and explicitly notes that standalone Vic.ai deployments are economically overkill below 1,000 invoices per month. Numeric targets month-end close management, cash matching, and flux/variance analysis, drafting first-pass variance explanations and reconciliation workpapers for controller review while expanding into an ERP replacement. Trullion and Tabs specialize in unstructured document-to-schedule compliance, with Trullion extracting audit-ready data for lease accounting and revenue recognition, and Tabs ingesting signed PDF and Word contracts downstream of CRM/CPQ systems to map performance obligations into ASC 606-compliant schedules. Meanwhile, Ramp and Brex embed AI directly into spend management workflows, automating policy enforcement, merchant mapping, and GL coding suggestions prior to ERP synchronization.

Competitor Group	Representative Vendors	Core Strengths	Key Weaknesses & Structural Gaps	Pricing & Onboarding Model
Iran Enterprise & Mid-Market	Rahkaran, Sepidar, Fardad, Shaygan, Payvast, Tadbir, Nosa	Deep Iranian statutory compliance (Moadian, Tamin DBF, 4/6/8-col trial balances); entrenched accountant familiarity.	Too complex/expensive for SMBs; rigid Windows/SQL legacy roots; manual file transfers; slow consultative demos.	High upfront license (7.6M to 178.3M+ Tomans) + annual support % + per-seat/dongle locks.
Iran Retail & Guild (اصناف)	Holoo, Dasht, Mahak, Parmis, Parsian, Gheyas, Mizan	Fast invoice issuance; guild-specific templates; free Moadian connection in base Holoo.	Outdated base UI; hardware dongles; weak multi-branch/cloud architecture; paid API add-ons (5M Tomans).	Tiered guild packages (1M to 69.7M Tomans); reseller-driven onboarding.
Iran Cloud Challengers	Hesabfa, Abrak (Odoo 19), Moj	Browser-accessible; instant signup; Abrak unifies open banking inquiries (150k Tomans/user/mo).	Freemium tiers restrict voucher counts (e.g., 100/mo) or lock vital reports; Odoo upgrades can break custom modules.	Monthly/annual SaaS per-user or per-module subscriptions.
Global Cloud SMB & Mid-Market ERP	QuickBooks, Xero, Zoho, Sage, NetSuite, Odoo, ERPNext	Mature APIs; global tax/banking feeds; ERPNext excels in BOM/Work Order costing.	Zero native Iranian compliance (Jalali, Sayad, Moadian, Tamin); NetSuite requires heavy implementation.	Per-user/month SaaS or open-source self-hosted/managed hosting.
Global AI Accounting Startups	Vic.ai, Numeric, Trullion, Tabs, Ramp, Brex	High touch-free AP automation (80–90%+); automated flux explanations; contract-to-ASC 606 parsing.	Point solutions bolted onto legacy ERPs; Vic.ai overkill below 1,000 invoices/month; opaque enterprise pricing.	High-ACV enterprise SaaS or fintech interchange/float monetization.

1.3 Where Roxira Clearly Wins: Product Strategy and Positioning

Roxira possesses a decisive architectural advantage: it combines a single, exact-money, reversal-only core ledger with native Iranian statutory compliance (roxira.ir) and international multi-currency/IFRS readiness (roxira.net), augmented by built-in agentic workflows at SMB-accessible modular pricing.

In the Iranian market (roxira.ir), Roxira should be positioned as the zero-entry, audit-proof cloud ERP for growing businesses and accounting firms. This positioning attacks the wide structural gap between entry-level tools like Holoo and Hesabfa—which lack enterprise period-lock controls, interactive AI bank reconciliation, and true modular depth—and mid-market suites like Sepidar and Fardad, which demand 73.8 million to 178.3 million Tomans upfront and require consultative, in-person demos. By offering instant self-serve browser onboarding, free core Moadian connectivity (matching Holoo's entry hook while eliminating its 5 million Toman web-service API fee), photo-to-voucher chat drafting, and one-click Social Security (Tamin) and seasonal tax exports, Roxira converts external accounting firms into its primary distribution channel.

In the international market (roxira.net), Roxira should be positioned as the modular, agent-native ERP for high-velocity small and medium enterprises (SMEs). Globally, businesses running on QuickBooks or Xero cannot economically justify bolting on standalone AI platforms like Vic.ai or Numeric until they reach mid-market scale exceeding 1,000 invoices per month. Roxira democratizes agentic AP voucher drafting, AI-assisted bank reconciliation, and automated period-close checklists inside the core ledger from day one, monetized per module rather than forcing an expensive migration to NetSuite.

2. Module Catalogue, Dependencies, and Packaging Strategy

To allow customers to purchase modules individually without compromising double-entry equilibrium or referential integrity, Roxira must enforce a strict Directed Acyclic Graph (DAG) of module dependencies. Every tenant automatically receives the Core Platform and Ledger Foundation (CORE), which houses the immutable journal, period locks, reversal-only correction engine, role-based access control (RBAC), and module entitlement gates.

2.1 Complete Module Map, Dependencies, and Launch Priorities

Module Code & Name	Functional Scope	Hard Dependencies	Target Market	Launch Priority
CORE: Ledger & Governance Foundation	Exact-money journal, multi-level COA (گروه/کل/معین/تفصیلی), period locks, reversal-only engine, RBAC, audit trail, data import.	None (Base Layer)	Iran & Global	Phase 1: Launch First (Built/In Progress)
INV-BILL: Commercial Invoicing & AR/AP	Sales/purchase invoices, pro-formas, consignment (امانی), dynamic multi-level price lists, customer/vendor sub-ledgers, ageing.	CORE	Iran & Global	Phase 1: Launch First (Built/In Progress)
TAX-IR: Moadian, VAT & Seasonal Compliance	22-char taxid (Verhoeff), JWS/JWE v2 signing, Type 1/2 & corrective/cancellation invoices, 10% VAT, Article 169 exports.	CORE, INV-BILL	Iran (roxira.ir)	Phase 1: Launch First (Built/In Progress)
TREASURY: Cash, Bank, Cheques & POS	Bank accounts, AI bank reconciliation, Sayad 16-digit cheque lifecycle, PC-POS bridge, Open Banking inquiries (Finotech/Jibit/Zibal).	CORE	Iran & Global	Phase 1: Launch First (Built/In Progress)
STOCK: Inventory & Warehouse (FIFO/Weighted Avg)	Multi-warehouse, quantity & Rial valuation (انبار تعدادی و ریالی), FIFO layers, stocktaking tags (تگ انبارگردانی), reorder alerts.	CORE	Iran & Global	Phase 1: Launch First (Built/In Progress)
PAYROLL-IR: Iranian Payroll & Tamin Insurance	Labor law calculations, attendance import, tax export, Tamin List Disk v6 (DSKKAR00.DBF & DSKWOR00.DBF with DSW_SPOUSE/DSW_INC).	CORE	Iran (roxira.ir)	Phase 1: Launch First (Built/In Progress)
AI-COPILOT: Agentic Accounting Suite	Photo-to-voucher chat drafting, AI reconciliation question flow, close checklist agent, anomaly detection, NL report builder.	CORE (Enhances all active modules)	Iran & Global	Phase 1: Launch First (Built/In Progress)
FIRM-HUB: Accounting Firm Multi-Client Portal	Cross-tenant client switcher, unified tax/Tamin filing calendar, bulk close status, delegated staff permissions, client doc inbox.	CORE[span_74](start_span)[span_74](end_span)[span_80](start_span)[span_80](end_span)	Iran & Global	Phase 1: Launch First (High-leverage GTM wedge)
CRM-SALES: Light CRM & Order Capture	Lead/deal pipeline, customer credit limits, quotation-to-invoice conversion, statement sharing via SMS/WhatsApp/Telegram.	CORE, INV-BILL	Iran & Global	Phase 2: Launch Later (90 Days; stabilize core first)
MFG-LITE: Assembly & Light Production	Multi-level BOM, Assembly/Work Orders, backflush material consumption (Stock Entry: Manufacture), actual unit cost roll-up.	CORE, STOCK, INV-BILL	Iran & Global	Phase 2: Launch Later (90–180 Days)
ASSETS: Fixed Assets & Depreciation	Asset register, straight-line/declining depreciation schedules, disposal/impairment vouchers (اموال و دارایی ثابت).	CORE	Iran & Global	Phase 2: Launch Later (180 Days)
CONTRACT: Project & Contractor Accounting	Work status statements (صورت وضعیت پیمانکاری), retention money (سپرده حسن انجام کار), project cost centers.	CORE, INV-BILL, TAX-IR	Iran & Global	Phase 2: Launch Later (180+ Days)
TAX-INTL: Global VAT, Peppol & Multi-Currency	Peppol BIS 3.0 e-invoicing, EU/UK/GCC VAT returns, automated FX revaluation, ASC 606/IFRS 15 contract schedules.	CORE, INV-BILL	Global (roxira.net)	Phase 2: Launch Later (180 Days)
NEVER: Heavy Shop-Floor Hardware & Non-Core Bloat	Proprietary 3D AI barcode hardware, live aisle RFID hardware, 8K dual-screen ad/music players, GPS courier fleet routing, native VoIP PBX.	N/A	Neither	Phase 3: Launch Never (Integrate via API/webhooks only)

2.2 Persona Packaging and Bundling Matrix

Although every module can be toggled à la carte via tenant entitlements, Roxira should present five pre-configured persona bundles during onboarding to eliminate decision fatigue. For Small Shops and Guilds (بسته فروشگاهی و اصناف), the package combines CORE, INV-BILL, TAX-IR (supporting both Type 2 retail and Type 1 B2B invoices), STOCK, and TREASURY (for PC-POS integration and Sayad cheque inquiry), competing directly against Holoo, Dasht, and Gheyas. For Service Businesses and Agencies (بسته خدماتی و شرکتی), the bundle pairs CORE, INV-BILL, TAX-IR, TREASURY, PAYROLL-IR, and CRM-SALES, challenging Hesabfa and Sepidar Service editions.

For Distributors and Wholesalers (بسته بازرگانی و پخش), the configuration unites CORE, INV-BILL (with multi-tier dynamic pricing and credit limits), TAX-IR, STOCK (multi-warehouse FIFO valuation), TREASURY (Sayad endorsement chain tracking and Open Banking), and AI-COPILOT. For Light Manufacturers and Workshops (بسته تولیدی و کارگاهی), the offering extends the Distributor bundle with MFG-LITE (BOM, Work Orders, and actual unit costing) and PAYROLL-IR. Finally, for Accounting Firms and Tax Advisors (بسته موسسات حسابداری), Roxira should unlock FIRM-HUB at zero cost for the firm itself while offering wholesale volume discounts of 20% to 40% on per-client module activations across CORE, TAX-IR, PAYROLL-IR, and AI-COPILOT.

3. Manufacturing Analysis: Scope, Comparison, and Minimum Viable Iranian Producer Module

3.1 Should Roxira Include Manufacturing Now?

Roxira should defer full Material Requirements Planning (MRP) and shop-floor execution, and instead launch a strictly scoped Assembly and Light Production (MFG-LITE) module in Phase 2 (Days 90 to 180). Evidence from the Iranian accounting software market demonstrates that premature or improper coupling of inventory and production costing is a primary source of structural software failure—explicitly cited in independent reviews as a core defect in competitors such as Baran and Rafa 8. Currently, Roxira has built or is completing 14 foundational capabilities, including FIFO inventory (STOCK), Moadian (TAX-IR), payroll (PAYROLL-IR), and bank reconciliation (TREASURY). Attempting to build full MRP, finite capacity scheduling, and shop-floor workstation tracking simultaneously will fragment engineering focus and risk corrupting FIFO valuation layers. However, Iranian workshops and light producers (کارگاه‌های تولیدی) represent a lucrative segment actively targeted by Sepidar Production and Holoo Industrial. What these producers urgently require is not factory-floor robotics, but accurate finished-goods unit costing (محاسبه بهای تمام شده) to defend profit margins in an inflationary Rial environment and satisfy Iranian tax audits.

3.2 Architectural Comparison of Manufacturing Sub-Systems

Benchmarking Sepidar Production and ERPNext v15/v16 Manufacturing clarifies the boundary between high-value accounting integration and low-ROI operational bloat:

Sub-System	Functional Mechanism (ERPNext / Sepidar Benchmark)	Accounting & Valuation Impact	Roxira Strategy
Bill of Materials (BOM)	Defines single-level or multi-level (nested sub-assembly) recipes, component quantities, scrap percentages, and substitute items; supports template BOMs for item variants.	Provides standard/estimated cost roll-up across nested levels.	Include in MFG-LITE (Day 90): Support 1-to-3 level BOMs with scrap % and variant templates.
Work Orders (دستور کار تولید)	Authorizes production of a specific batch quantity from a versioned BOM; tracks raw material transfer from warehouse to Work-in-Progress (WIP) and final receipt of finished goods.	Triggers a Stock Entry of type Manufacture, consuming FIFO raw material layers and capitalizing finished goods.	Include in MFG-LITE (Day 90): Support both two-step (WIP transfer -> Completion) and one-step (backflush on completion) flows.
Production Costing (بهای تمام شده)	Combines exact FIFO raw material costs consumed in the Work Order with allocated direct labor and overhead rates to compute real per-unit and batch cost.	Posts balanced GL entries: Dr Inventory - Finished Goods, Cr Inventory - Raw Materials, Cr Applied Labor/Overhead.	Include in M[span_190](start_span)[span_190](end_span)FG-LITE (Day 120): Essential for Iranian tax audits (Article 147/148 acceptable cost of sales) and pricing.
MRP (Material Requirements Planning)	Explodes sales orders and forecasts across multi-level BOMs, nets against on-hand/on-order stock, and auto-generates Purchase Requisitions and sub-assembly Work Orders.	No direct GL impact; planning-only layer.	Defer to Phase 3 (Day 180+): Initially replace with simple BOM shortage check ("Make vs. Buy" stock availability alert on Work Order creation).
Shop Floor & Job Cards	Tracks operator-level time logs across physical Work Centers and Plant Floors via Job Cards.	Feeds actual operational time into Work Order costing.	Avoid / Defer: Iranian SMB workshops rarely maintain real-time tablet terminals at machines; use standard or monthly-apportioned overhead/labor rates instead.
Quality Management (QC)	Enforces in-process and final inspection gates before finished goods enter salable stock.	Routes rejected units to a Scrap/Rework warehouse and adjusts net good-unit cost.	Simplify in MFG-LITE: Include a single Good Quantity vs. Scrap/Wastage Quantity field on Work Order completion.

3.3 Smallest Useful Version for Iranian Producers (MFG-LITE Specification)

To satisfy Iranian production workshops without over-engineering, MFG-LITE requires three core relational entities and one deterministic accounting workflow. First, boms and bom_items link a header to a finished item_id with a version number, base output quantity, and standard overhead or labor surcharge (expressed as a fixed Rial amount per unit or a percentage of material cost), while child lines specify raw item_id, required quantity, unit of measure (UOM), and normal wastage percentage. Second, work_orders link bom_id, Planned_Qty, Produced_Good_Qty, Scrap_Qty, Source_Warehouse_ID (Raw Materials), an optional WIP_Warehouse_ID, and Target_Warehouse_ID (Finished Goods). Third, when a Work Order transitions to COMPLETED, the FIFO Cost Roll-Up Engine pops the exact FIFO cost layers of the consumed raw materials from Source_Warehouse_ID, adds the applied labor and overhead voucher allocation, divides the total batch cost by Produced_Good_Qty (so normal scrap cost is absorbed into salable units), and inserts a new FIFO cost layer into Target_Warehouse_ID alongside an immutable reversal-only journal voucher.

4. Reporting Architecture and Statutory Catalogue

4.1 Core Financial, Operational, and Iranian Statutory Reports

Iranian accounting practice differs sharply from Anglo-Saxon SMB software in its reliance on multi-column Trial Balances (تراز آزمایشی چندستونی) and four-level hierarchical charts of accounts: Group (گروه), General Ledger (کل), Subsidiary Ledger (معین), and Detailed/Floating Dimension (تفصیلی شناور). While QuickBooks or Xero users typically view a simple two-column trial balance, Iranian chief accountants and tax auditors require four-column, six-column, eight-column, and ten-column trial balances to verify opening balances, prior-period cumulative turnover, current-period turnover, total turnover, and ending balances before closing temporary accounts. Furthermore, Iranian accounting workflows traditionally check for classic transposition errors (ثبت مقلوب, where the discrepancy between debit and credit columns is divisible by 9)—an error class that Roxira's exact-money ledger prevents by construction at voucher commit time.

Report Category	Report Name (Persian / English)	Structural Specification & Column Schema	Statutory / Operational Purpose
Trial Balances (تراز آزمایشی)	2-Column Trial Balance (تراز دو ستونی)	Account Code, Account Name, Ending Debit Balance, Ending Credit Balance.	Quick verification of \sum \text{Dr} = \sum \text{Cr} across permanent and temporary accounts.
Trial Balances	4-Column Trial Balance (تراز چهار ستونی)	Adds Period Turnover Debit (گردش بدهکار) and Period Turnover Credit (گردش بستانکار) before the 2 ending balance columns.	Standard monthly management and auditor review.
Trial Balances	6-Column Trial Balance (تراز شش ستونی)	Columns 1–2: Cumulative Turnover Prior to Period (e.g., 1 Farvardin to 31 Mordad); Columns 3–4: Turnover Within Selected Period (e.g., 1 to 31 Shahrivar); Columns 5–6: Ending Balance Dr/Cr.	Isolates specific monthly or seasonal activity against year-to-date cumulative movements.
Trial Balances	8-Column & 10-Column Trial Balance (تراز هشت و ده ستونی)	8-Column prepends Opening Balance Dr/Cr (مانده ابتدای دوره / تراز افتتاحیه) before prior turnover and period turnover; 10-Column inserts Total Cumulative Turnover Dr/Cr (جمع کل گردش) before ending balances.	Full fiscal year audit reconciliation from opening voucher to closing voucher.
Trial Balances	Hierarchical Trial Balance (تراز سلسله مراتبی)	Expandable tree view rendering کل (General) \rightarrow معین (Subsidiary) \rightarrow تفصیلی (Detailed/Floating) within any 2/4/6/8-column layout.	Multi-level audit drill-down.
Statutory Ledgers (دفاتر قانونی)	Electronic General Journal & General Ledger (دفتر روزنامه و دفتر کل الکترونیکی)	Chronological finalized voucher listing (Journal) and account-grouped chronological roll-up (General Ledger). Requires finalized (تایید نهایی) sequential voucher numbering with zero draft/void gaps.	Semi-annual/annual upload to Tax Authority portal prior to Article 100/110 tax return deadline.
Financial Statements	Balance Sheet, P&L & Cash Flow (ترازنامه، سود و زیان، جریان وجوه نقد)	Balance Sheet includes permanent accounts (حساب‌های دائم) ordered by liquidity (نقدشوندگی: most liquid assets first); P&L aggregates temporary accounts; Cash Flow (Direct/Indirect) + 13-week rolling cash forecast.	Tax return attachment (گواهی ترازنامه و سود و زیان), bank credit applications, and executive treasury planning.
Sub-Ledger & Working Capital	AR/AP Ageing & Party Cardex (مرور حساب و راس‌گیری بدهکاران/بستانکاران)	Buckets open invoices/cheques by 0–30, 31–60, 61–90, 90+ days; computes weighted average maturity date (راس چک/فاکتور).	Collections prioritization and vendor payment scheduling.
Inventory & Profitability	Inventory Cardex, Stocktaking & Margin Analysis (کاردکس انبار، تگ انبارگردانی، سود ناخالص)	Quantity and Rial cardex per item/warehouse; FIFO layer consumption breakdown; gross profit by item, brand, customer, and invoice.	Physical inventory count reconciliation (کسری و اضافات انبار) and dynamic pricing.
Budgeting	Budget vs. Actual & Flux Analysis (بودجه در مقایسه با عملکرد)	Period-by-period variance in Rial/currency and percentage per GL account and cost center, paired with AI-drafted variance explanations.	Departmental spend control and month-end controller review.

4.2 Iranian Statutory File Formats and Export Specifications

Beyond PDF and Excel reports, Roxira must generate byte-accurate statutory electronic files for Iranian government portals. Under Circular No. 5806/1403/5020 dated 1403/09/17 (December 2024), the Social Security Organization (سازمان تامین اجتماعی) mandated version 6 of the l[span_130](start_span)[span_130](end_span)[span_132](start_span)[span_132](end_span)[span_134](start_span)[span_134](end_span)ist disk schema for uploading monthly payroll insurance via es.tamin.ir pursuant to Article 39 of the Social Security Law. Roxira's payroll exporter must generate two Unicode-encoded FoxPro/dBase .DBF files—DSKK[span_26](start_span)[span_26](end_span)AR00.DBF for workshop summary data and DSKWOR00.DBF for insured employee records (plus .TXT equivalents where required)—adhering to strict formatting constraints. Specifically, Jalali dates must be formatted as 8 characters without slashes (e.g., 14031001), gender strings must be "مرد" or "زن", no leading or trailing spaces or newline characters are permitted, character fields must strip " ' < > &, and DSK_KIND must be populated with 0. Crucially, version 6 added mandatory columns for Marital Allowance (DSK_SPOUSE / DSW_SPOUSE) and Base Seniority (DSK_INC / DSW_INC); omitting these fields results in automatic retroactive debt calculation and collection against the employer.

File Name	Scope	Key Field Schema (Version 6 - 1403/1404+)
DSKKAR00.DBF	Workshop Summary (اطلاعات کارگاه)	Col 1 DSK_ID (Workshop Code), Col 16 DSK_TTOTL (Total Monthly Wage & Benefits, Insurable + Non-Insurable, Numeric 12), Col 17 DSK_TBIME (Total Employee Insurance Share, Numeric 12), Col 18 DSK_TKOSO (Total Employer Share, Numeric 12), plus new columns DSK_INC (Total Base Seniority) and DSK_SPOUSE (Total Marital Allowance), and DSK_KIND = 0.
DSKWOR00.DBF	Insured Employees Detail (اطلاعات بیمه‌شدگان)	29 exact columns: 1: DSW_ID (Char 10, Workshop Code), 2: DSW_YY (Num 2, Year), 3: DSW_MM (Num 2, Month), 4: DSW_LISTNO (Char 12, List No), 5: DSW_ID1 (Char 10, 8-digit Insurance No left-padded with 00), 6: DSW_FNAME (Char 100), 7: DSW_LNAME (Char 100), 8: DSW_DNAME (Char 100, Father Name), 9: DSW_IDNO (Char 15, Birth Cert No), 10: DSW_IDPLC (Char 100, Issue Place), 11: DSW_IDATE (Char 8), 12: DSW_BDATE (Char 8, Birth Date), 13: DSW_SEX (Char 3), 14: DSW_NAT (Char 10), 15: DSW_OCP (Char 100, Job Title), 16: DSW_SDATE (Char 8, Start Date), 17: DSW_EDATE (Char 8, End Date), 18: DSW_DD (Num 2, Days Worked), 19: DSW_ROOZ (Num 12, Daily Wage), 20: DSW_MAH (Num 12, Monthly Wage), 21: DSW_MAZ (Num 12, Monthly Benefits), 22: DSW_MASH (Num 12, Total Insurable Wage+Benefits), 23: DSW_TOTL (Num 12, Total Wage+Benefits), 24: DSW_BIME (Num 12, Employee 7% Share), 25: DSW_PRATE (Num 2), 26: DSW_JOB (Char 6, 6-digit Job Code; alphanumeric indicates hazardous jobs), 27: PER_NATCOD (Char 10, National ID), 28: DSW_INC (Num 12, Base Seniority / پایه سنوات), 29: DSW_SPOUSE (Num 12, Marital Allowance / حق تاهل).

In parallel, for the Tax Authority Moadian System and Article 169 Seasonal Reports (معاملات فصلی و ارزش افزوده), Article 7 of the Store Terminals and Moadian System Law stipulates that electronic invoices successfully registered in Moadian automatically satisfy Article 169 Direct Tax Law seasonal transaction reporting obligations, relieving both buyer and seller of redundant filings for those invoices. However, for transactions occurring outside Moadian—such as legacy adjustments or non-member counterparties—taxpayers must still review, edit, and submit their pre-filled seasonal VAT declaration within one month after the end of each season (Spring by the end of Tir, Summer by the end of Mehr, Autumn by the end of Dey, and Winter by the end of Farvardin) and generate Article 169 seasonal exports. Roxira must therefore provide a unified Moadian vs. General Ledger Reconciliation Report that separates Moadian-confirmed invoices from unconfirmed or offline invoices to prevent double-counting on quarterly VAT declarations.

4.3 Drill-Down to Source and Scheduled Reporting Engine

Every figure displayed on any Roxira report must be hyperlinked via a deterministic five-hop drill-down chain: clicking a Financial Statement Line opens the 8-Column Hierarchical Trial Balance (کل/معین/تفصیلی), which drills into the Account Ledger Cardex, which links to the Immutable Journal Voucher (complete with its Reversal Chain links), which finally displays the Source Operational Document (the Invoice PDF, Photo Attachment, Moadian Reference ID, Bank Statement Row, or Work Order). Scheduled reports are executed asynchronously via BullMQ cron workers (report-scheduler queue) running inside a read-only transaction, rendering right-to-left (RTL) Persian PDFs with embedded fonts and Jalali dates alongside .xlsx workbooks, delivered via Cloudflare Email Routing or webhook, Telegram, and WhatsApp notifications.

5. Multi-Persona Admin Panels and Screen Catalogue

Roxira's Next.js App Router frontend (built with Tailwind CSS and shadcn/ui) must support bi-directional layout switching (dir="rtl" with Jalali date pickers and Rial/Toman formatting on roxira.ir; dir="ltr" with Gregorian calendars and decimal currencies on roxira.net) across four distinct control planes:

Control Plane	Target Persona	Core Screens & Navigation Architecture	Key Functional Capabilities & Guardrails
1. Customer Workspace (/[tenantSlug]/...)	Business Owner, Chief Accountant, Cashier, Warehouse Clerk	• Command Dashboard: Real-time cash position, 13-week cash forecast, overdue AR/AP, Moadian 7-day/12-day pending submission countdown.
• AI Inbox & Chat Drawer: Photo/PDF invoice dropzone, side-by-side voucher draft review, bank reconciliation question cards.
• Accounting & Ledgers: Voucher entry grid (keyboard-first), COA tree manager, Period Lock manager, 2/4/6/8/10-col Trial Balance viewer.
• Commercial & POS: Fast retail/B2B invoice screen, PC-POS trigger button, Moadian status queue (Pending/Success/Failed/Rejected with 1-click corrective/cancellation wizard).
• Treasury & Cheques: Sayad 16-digit cheque register, color-status badge (White/Yellow/Orange/Brown/Red), 1-click Finotech/Jibit inquiry button.
• Payroll & Inventory: Monthly payroll run, 1-click DSKKAR00/DSKWOR0[span_35](start_span)[span_35](end_span)0 downloader, FIFO cardex, BOM & Work Order screen.	Keyboard-driven data entry (F2 save, F4 account lookup, Alt+R reverse voucher) to match Holoo/Sepidar muscle memory; inline Moadian pre-validation before API dispatch.
2. Organisation Admin (/[tenantSlug]/settings/...)	Tenant Owner, IT/Finance Administrator	• Module Marketplace & Entitlements: Self-serve module activation/deactivation with transparent dependency preview.
• Users, Roles & ABAC Matrix: Role assignment (Cashier, AP Clerk, Senior Accountant, Auditor) + row/branch restrictions (شعبه) and approval limits.
• Statutory & Banking Credentials Vault: Moadian Fiscal ID (شناسه یکتای حافظه مالیاتی) and X.509 certificate/private key uploader; Open Banking provider switcher (Sandbox vs. Operational toggle for Finotech/Jibit/Zibal) with monthly inquiry cost tracker.
• Data Import & Backup Export: Guided wizard for migrating Excel/CSV/DBF exports from Sepidar, Holoo, and Hesabfa; 1-click full tenant encrypted snapshot export.	Masks sensitive National IDs and card numbers (603799******9993) in inquiry logs; enforces 2FA (TOTP/SMS) for certificate and role changes.
3. Accounting Firm Multi-Client View (/firm/...)	External CPA, Bookkeeping Firm Partner, Tax Consultant	• Cross-Client Matrix Dashboard: Single-screen grid of all managed client tenants showing: Unreconciled Bank Lines, Draft Vouchers Pending Approval, Moadian Expiring Invoices (<48h left), VAT Return Status, and Tamin Article 39 Submission Status.
• Zero-Reload Context Switcher: Cmd+K / Ctrl+K instant tenant switcher with persistent visual banner indicating active client.
• Staff Workload & Delegation: Assign specific junior bookkeepers to specific client subsets with maker-checker approval gates.
• Wholesale Billing Console: Manage bundled module subscriptions across all client entities on a single consolidated invoice.	Eliminates per-tenant re-authentication while strictly scoping every API call to the selected target tenant_id via short-lived scoped JWTs.
4. Platform Operator Console (/ops/...)	Roxira Core Engineering, FinOps, Support & Compliance Ops	• Tenant & Entitlement Registry: Provision/suspend tenants, override module entitlements, inspect DB row counts and storage consumption per tenant.
• AI FinOps & LiteLLM Router Console: Live token usage, latency, failure rates, and cost burn per tenant and per model provider (Groq, Mistral, Google AI Studio, SambaNova, DeepSeek, OpenRouter); hard circuit-breaker and per-tenant monthly budget caps.
• Statutory & Open Banking Health Monitor: Global error-rate telemetry for Moadian (intamedia.ir / tp.tax.gov.ir) and Finotech/Jibit endpoints (tracking 5xx spikes like Moadian 05139/05151).
• Break-Glass Support & Immutable Audit Explorer: Time-bounded, reason-logged @AllowCrossTenant read-only impersonation session with cryptographic audit trail.	Operates strictly under separate app_admin credentials for cross-tenant telemetry; never allows silent mutation of customer financial ledgers.

6. Safe Agentic Accounting: Design, Governance, and Reality Check

6.1 Separating Proven AI Accounting Workflows from Vendor Hype

Empirical evidence from the past 18 months demonstrates that artificial intelligence succeeds in accounting when architected as a deterministic validator and structured proposal engine upstream of an immutable double-entry ledger, and fails when permitted to mutate ledger state directly or perform unconstrained arithmetic. Four workflows are proven in production across leading deployments. First, multimodal document-to-voucher and AP drafting—extracting header and line items from invoice photos or PDFs, mapping vendor identities, proposing GL accounts (معین/تفصیلی), and executing two-way or three-way PO matching—achieves 80–90%+ touch-free processing rates once conditioned on tenant-specific historical postings. Second, hybrid deterministic plus agentic bank reconciliation pairs exact and windowed matching on transaction reference numbers (شماره پیگیری/شماره ارجاع) with an interactive AI question flow that prompts the human user to clarify ambiguous transfers. Third, first-pass close and flux explanations allow an agent to inspect ledger movements at period-end, flag accounts exceeding variance thresholds, and draft natural-language explanations tied to underlying vouchers for controller review. Fourth, contract and lease schedule extraction reliably parses signed PDFs into structured amortization or ASC 606 revenue recognition schedules linked directly to source text spans.

Conversely, three heavily marketed AI concepts represent dangerous hype that Roxira must avoid. First, "zero-human autonomous general ledger posting" without confidence thresholds or historical vendor conditioning violates auditability and creates compounding reconciliation errors; even Vic.ai routes invoices straight through to payment only after learning vendor patterns and surpassing strict confidence gates. Second, "free-form Text-to-SQL financial reporting"—where an LLM writes raw SQL queries against a multi-tenant database to compute financial statements—leads to hallucinated joins, sign inversions, bypassed accounting invariants, and severe cross-tenant data leakage risks. Natural-language reporting in Roxira must instead translate user intent into parameterized calls to the deterministic reporting engine (for example, selecting report type TRIAL_BAL[span_54](start_span)[span_54](end_span)[span_57](start_span)[span_57](end_span)ANCE_6_COL, date range 1404/06/01 to 1404/06/31, and account filter). Third, hardware-gimmick retail AI claims—such as Holoo's advertised "scanning 500 items in 7 seconds from a photo"—are physically unreliable in retail checkouts where occluded items and exact 13-digit Moadian goods/service IDs (sstid) are legally mandatory.

http://googleusercontent.com/visual_element_1

6.2 Agent Catalogue, Autonomy Levels, and Human Approval Matrix

Roxira governs agent execution across its Python FastAPI AI service and NestJS core using a four-tier autonomy taxonomy. Level 0 (Deterministic Rule) executes 100% algorithmically in TypeScript and SQL with zero LLM involvement. Level 1 (Copilot Draft) prepares a structured JSON draft (DraftVoucherDTO[span_45](start_span)[span_45](end_span), DraftTaxReturnDTO) that requires an explicit human click (Approve & Post) before touching the ledger. Level 2 (Bounded Conditional Autopilot) auto-executes low-risk, reversible, or non-ledger actions—such as matching a bank line where amount, date, and reference ID match 100%, or queuing a Moadian status inquiry—when calibrated confidence is $\ge 0.98$ and the transaction value falls below tenant-configured Rial or currency caps, routing all exceptions to a human review queue. Level 3 (Autonomous Alert / Guardrail) runs asynchronously in the background via BullMQ, flagging anomalies or placing suspicious disbursements on hold without human prompting, while never mutating ledger balances.

Agent Name	Core Task & Mechanism	Autonomy Level	Human Approval Gate	Audit Evidence Stored
1. Voucher Drafting Agent (VoucherDraftAgent)	Ingests invoice photos/PDFs or voice notes (via AssemblyAI) from chat; extracts vendor, Jalali date, line items, 10% VAT, and proposes balanced کل/معین/تفصیلی entries using LightRAG over the tenant's past 12 months of vouchers.	Level 1 (Default) / Level 2 (Recurring utility bills below cap)	Mandatory side-by-side human review & Post Voucher click for all standard invoices.	Source image SHA-256 hash in R2, bounding-box OCR JSON, RAG retrieved exemplar IDs, model ID, human diff before commit.
2. Bank & POS Reconciliation Agent (ReconAgent)	Stage 1 (L0) runs exact/windowed matching on amount, date, and شماره مرجع/شماره تراکنش. Stage 2 (L1) clusters unmatched lines, searches open AR/AP/cheques, and generates targeted multiple-choice questions for the user.	Level 2 (Exact ID + Amount match) / Level 1 (Ambiguous lines)	User answers the AI question card or confirms proposed match batch before settlement voucher is created.	Bank CSV/API row ID, matching score breakdown, user question/answer transcript, resulting voucher ID.
3. Period Close & Flux Agent (CloseCopilot)	Scans trial balance at month/season end; verifies all bank/POS clearing accounts, negative inventory layers, unsubmitted Moadian invoices (>5 days old), and drafts flux variance explanations.	Level 1	Chief Accountant reviews checklist, approves adjusting/accrual drafts, and clicks Lock Period.	Snapshot of pre-close trial balance, variance calculations, drafted narrative, approver user ID + timestamp.
4. Anomaly & Fraud Detection Agent (AuditGuardAgent)	Runs nightly/real-time checks for duplicate invoice numbers/amounts, weekend/off-hours manual journal entries, round-Rial threshold splitting, Sayad cheque color degradation (Yellow/Orange/Red), and IBAN ownership mismatches.	Level 3	Holds flagged payment/voucher in PENDING_AUDIT_REVIEW state requiring Organization Admin override.	Triggered rule/heuristic vector, statistical z-score, Finotech/Sayad inquiry log ID, override justification note.
5. Collections & Dunning Agent (CollectionsAgent)	Analyzes AR ageing and upcoming Sayad cheque maturities; drafts polite, culturally calibrated Persian/English payment reminders for SMS, WhatsApp, Telegram, or Email.	Level 1 (High-value/disputed) / Level 2 (Standard T-3 day cheque reminders)	Finance manager approves batch outreach list or sets auto-send rules per customer tier.	Customer ageing snapshot, message template + rendered text, delivery receipt, opt-out status.
6. Tax & Statutory Prep Agent (StatutoryPrepAgent)	Cross-checks sales/purchase ledgers against Moadian portal status (SUCCESS, PENDING, FAILED), validates 13-digit sstid codes, reconciles 10% VAT vs exempt/zero-rated items, and pre-validates Tamin DSKWOR00.DBF fields.	Level 1	Tax Accountant reviews reconciliation workpaper and explicitly signs/transmits via Moadian key or downloads DBF.	Pre-submission validation log, Verhoeff check-digit proof, Moadian reference[span_325](start_span)[span_325](end_span)Number and uid.
7. Cash Forecasting Agent (TreasuryForecastAgent)	Projects 13-week rolling cash flow by combining deterministic scheduled inflows/outflows (post-dated Sayad cheques, payroll, VAT deadlines) with historical collection velocity per customer.	Level 1 (Advisory projection)	Read-only planning simulation; user toggles scenario assumptions (e.g., "Delay vendor batch by 14 days").	Input assumptions vector, historical payment lag distribution per counterparty, confidence intervals.
8. Natural-Language Reporting Agent (NLRepo[span_64](start_span)[span_64](end_span)rtAgent)	Translates Persian/English questions (e.g., "فروش خالص شهریور به تفکیک مشتری چقدر بود؟") into strongly-typed JSON filter ASTs executed by the deterministic NestJS reporting service.	Level 0/1 (Read-only execution)	Read-only; displays the exact filter pills applied so the user can visually verify the query scope.	User prompt, generated JSON AST, exact SQL query plan executed, row count returned.

6.3 Prompt Injection Defenses, Explainability, Model Evaluation, and Cost Control

External artifacts—such as optical character recognition (OCR) text from supplier invoices, bank statement descriptions, or customer emails—must be treated as untrusted inputs capable of carrying indirect prompt injection payloads. For example, a malicious document could contain hidden text instructing an agent to code an invoice to an unreviewed expense account or alter an IBAN. Roxira's FastAPI AI pipeline neutralizes this threat through structural privilege separation. Untrusted OCR or document text is wrapped inside XML-escaped data delimiters and processed exclusively by a tool-less structured extraction call (using constrained JSON Schema / Pydantic decoding) whose only permitted output is a passive extraction data transfer object (vendor_name, raw_date, line_items, numeric_amounts). The extraction model has zero access to database mutation tools, webhook triggers, or approval state transitions. Deterministic NestJS validators subsequently verify that $\sum \text{Line Amounts} + \text{VAT} - \text{Discounts} == \text{Invoice Total}$ using exact integer arithmetic before any voucher draft is persisted.

To guarantee explainability and audit readiness, every AI-assisted record stores an immutable ai_audit_metadata JSONB envelope containing trace_id, model_provider, model_version, prompt_template_hash, source_document_r2_key, extracted_bounding_boxes, rag_context_voucher_ids (identifying the exact three to five historical vouchers LightRAG retrieved to infer the معین/تفصیلی code), and human_reviewer_id. When an auditor inspects an AI-drafted voucher, the user interface highlights the corresponding bounding-box crop on the original invoice image for each extracted field.

For continuous model evaluation and cross-family review, Roxira's separate agent factory should maintain a golden benchmark dataset of 500+ anonymized Iranian (Jalali dates, mixed Rial/Toman figures, thermal receipts) and international invoices. Nightly regression evaluations run across the LiteLLM router (spanning Groq, Mistral, Google AI Studio, SambaNova, DeepSeek, and OpenRouter) to track Exact Field Match Rate, GL Coding Top-1 Accuracy, and Arithmetic Balance Rate. High-stakes drafts utilize cross-family verification: a fast vision extraction pass (such as Gemini Flash via Google AI Studio or Mistral Pixtral) is cross-checked by a reasoning model from a distinct weight family (such as DeepSeek-V3/R1 or Llama-3.3-70B on Groq or SambaNova).

To enforce FinOps cost control, LiteLLM routes 85%+ of routine extraction, classification, and reconciliation question generation to free-tier or ultra-low-cost providers with automatic fallback on HTTP 429 rate limits. Prior to invoking any model, the ingestion service computes a SHA-256 hash of every uploaded image or PDF; if an identical document was already parsed within the tenant, the cached JSON is returned from Redis or PostgreSQL at zero token cost. Similarly, once a tenant confirms a vendor-to-معین/تفصیلی mapping three times, that rule is cached deterministically in PostgreSQL so repeat invoices bypass LLM coding entirely. Finally, a Redis token-bucket quota enforces hard per-tenant monthly AI budgets in the FastAPI gateway, alerting the organization administrator at 80% consumption and degrading gracefully to manual voucher entry—never blocking core accounting—at 100%.

7. Banking, POS, Cheque, and E-Commerce Integrations: Iran and Global

7.1 Iranian Financial Infrastructure Integrations

Operating a modern ERP in Iran requires bridging fragmented banking file exports, centralized Central Bank of Iran (CBI) registries, and local payment hardware protocols. Iranian corporate internet banking portals (including Mellat, Melli, Saderat, Tejarat, Parsian, Saman, Pasargad, and Keshavarzi) export account statements in inconsistent .csv, .xls/.xlsx, and legacy .txt schemas featuring varying Jalali date formats (1404/07/01 vs. 14040701), non-standard Arabic/Persian character encodings (ی/ي and ک/ك), and split versus signed debit/credit columns. Roxira's ingestion pipeline must first run a Persian Normalization and Bank-Fingerprint Parser that canonicalizes UTF-8 characters, strips formatting commas, converts Jalali dates to UTC timestamps alongside integer Jalali YYYYMMDD keys, and extracts the unique transaction reference (شماره پیگیری / شماره مرجع / شناسه واریز).

For programmatic Open Banking (بانکداری باز), direct bilateral integrations with individual Iranian banks entail lengthy regulatory approvals. Consequently, the proven industry pattern—demonstrated in Abrak's Odoo 19 localization—is to integrate via licensed Open Banking aggregators: Finotech (finnotech.ir), Jibit, and Zibal. As documented in Finotech's v2 API (GET /oak/v2/clients/{clientId}/statement, POST /oak/v2/clients/{clientId}/transferTo, and /facility/v2/clients/{clien[span_49](start_span)[span_49](end_span)t_id}/cardToIban), Roxira should store provider base URLs, endpoint paths, and parameter mappings as database configuration records rather than hardcoded logic, allowing tenants to switch seamlessly between Sandbox (making zero external network calls) and Operational modes once their API credentials are provisioned. Because every inquiry call to Finotech, Jibit, or Zibal incurs a transaction fee, Roxira must execute two local zero-cost mathematical validations before firing any external request: the Luhn Algorithm (ISO/IEC 7812) on all 16-digit Shetab card numbers, and the Mod-97 check (ISO 13616) on all 26-character Iranian IBAN (شبا) strings. Every inquiry is logged in an audit table that records the provider, latency, status, and fee while masking sensitive card and National ID digits (603799******9993) to prevent the audit log from becoming a data leak vector.

In treasury operations, the Sayad Cheque System (سامانه صیاد و چک صیادی), governed by the 1397 and 1400 amendments to the Cheque Issuance Law, mandates a unique 16-digit Sayad ID (شناسه صیاد) on every cheque leaf. Bearer cheques (در وجه حامل) are prohibited for legal entities, and any cheque transfer or endorsement (ظهرنویسی) not registered electronically in Sayad lacks legal validity in judicial proceedings. Roxira's TREASURY module must model the complete Sayad state machine: ISSUED_PENDING_REGISTRATION $\rightarrow$ REGISTERED_IN_SAYAD (by the issuer) $\rightarrow$ CONFIRMED_BY_BENEFICIARY (mandatory before cashing) $\rightarrow$ ENDORSED_TRANSFERRED (tracking the chain of custody) $\rightarrow$ CLEARED or BOUNCED. Before a cashier or accountant accepts a cheque, clicking "Inquiry Sayad" queries the configured Open Banking endpoint (استعلام چک صیادی) using the 16-digit Sayad ID and/or 10-digit National ID. The response populates the issuer's official CBI credit color status—White (zero bounced cheques), Yellow, Orange, Brown, or Red—directly onto the cheque record and automatically blocks sales order release if the counterparty status is Orange, Brown, or Red.

For in-store retail and distribution, typing invoice totals manually into standalone POS terminals introduces cashier errors and reconciliation discrepancies. Under Shaparak regulations, integrated PC-POS / IPOS (کارتخوان فعال سیستمی) bridges the accounting software directly to the physical card terminal. Because Roxira runs in a web browser while the physical POS terminal resides on the merchant's local LAN, USB/Serial port, or Wi-Fi, Roxira leverages official Payment Service Provider (PSP) local background services. Specifically, Behpardakht Mellat (به پرداخت ملت) distributes a Windows service (POSPC BEHPARDAKHT / pospc_bpm running on .NET Framework 4) that exposes a local web service on port 1024 and communicates with the physical POS terminal over TCP/IP on its configured LAN IP and port 1024 with a Read Timeout of 180000 ms (3 minutes). Asan Pardakht (آپ) and other PSPs provide analogous local web-service bridges. When a Roxira cashier clicks "Send to POS," the Next.js client executes a localhost call to 127.0.0.1:1024 (or communicates with a lightweight Roxira Local Bridge tray utility for serial-only terminals), transmitting the exact invoice amount in Rials. Upon card swipe and PIN entry, the terminal returns the Shaparak Transaction Reference Number (شماره مرجع/شماره تراکنش), Terminal ID (trmn), Card Mask, and Acceptance Number (acn), which Roxira automatically binds into InvoicePaymentDto for Moadian submission and marks the invoice settled.

For online shops, Internet Payment Gateways (IPGs / درگاه پرداخت اینترنتی), and marketplaces such as Digikala, Roxira should provide native webhook listeners and polling connectors. Legacy competitors charge 12,000,000 to 23,000,000 Tomans just to renew an online store connector add-on. Bundling native WooCommerce, Shopify, Digikala seller settlement, and IPG (Asan Pardakht, Zarinpal, Jibit, Zibal, Behpardakht) reconciliation—including multi-IBAN split settlement (تسهیم) and gateway fee accounting—directly into INV-BILL and TREASURY creates an immediate competitive differentiator. Legally, Roxira must enforce two operational guardrails in Iran: outbound Open Banking transfers (transferTo) must require Shahkar mobile-to-National-ID matching (تطبیق شاهکار), Shahab code verification (استعلام کد شهاب), and human signatory 2FA, while all POS terminals and IPGs must be registered against the taxpayer's Fiscal ID (تخصیص ابزار پرداخت با شناسه یکتا) in tp.tax.gov.ir.

7.2 Global Equivalents (roxira.net)

To prevent codebase divergence between roxira.ir and roxira.net, external financial rails are abstracted behind four TypeScript provider interfaces in NestJS:

Integration Domain	NestJS Interface Abstraction	Iran Implementation (roxira.ir)	Global Implementation (roxira.net)
Bank Feeds & KYC	IBankingProvider	Finotech, Jibit, Zibal Open Banking APIs + Normalized Iran Bank CSV/XLS Parser + Luhn/ISO-13616 Mod-97.	Plaid (US/CA), GoCardless / Tink (EU/UK PSD2 Open Banking), + ISO 20022 camt.053 / OFX / MT940 parsers.
In-Store POS	IPosTerminalAdapter	Localhost HTTP/WebSocket bridge to Behpardakht (pospc_bpm port 1024), Asan Pardakht, Saman PC-POS.	Cloud-to-terminal APIs: Stripe Terminal (Server-Driven REST API) and Adyen Terminal API (Cloud/Local).
Payment Instruments	IPaymentInstrumentService	Sayad 16-digit Cheque Registry + CBI Color Inquiry + Paya/Satna batch export.	SEPA Direct Debit (pain.008), ACH/NACHA files, BACS, and Stripe/Adyen payment links.
E-Invoicing & Tax	IEInvoicingProvider	Iranian Moadian API v2 (22-char Verhoeff taxid, JWS/JWE A256GCM + RSA-OAEP-256).	Peppol BIS Billing 3.0 / UBL XML (EU/APAC), ZATCA Phase 2 (Saudi Arabia), KSeF/FacturaE.

8. Public Platform, API Ecosystem, and Plugin Security

To replace fragile desktop add-ons—such as Holoo's 5 million Toman web-service kit—with an enterprise-grade developer platform, Roxira's public API (/api/v1/...) must enforce cryptographic authentication, strict idempotency, and out-of-process plugin isolation.

Machine-to-machine integrations authenticate via prefixed API keys (rx_live_<tenant_short_id>_<32_byte_random_base62> and rx_test_<tenant_short_id>_...), where only the SHA-256 hash (api_keys.key_hash) is persisted in PostgreSQL alongside a visual prefix. Third-party user-delegated applications authenticate via OAuth 2.0 Authorization Code flow with PKCE, issuing short-lived (15-minute) JWT access tokens signed with EdDSA/RS256 and rotating refresh tokens. Every token embeds a cryptographically verified tid (tenant_id) claim; tenant identity is never accepted from mutable query parameters or unverified request headers. Access is governed by fine-grained resource-action scopes mapped directly to tenant module entitlements (ledger:vouchers:read, ledger:vouchers:draft, invoicing:invoices:write, treasury:reconciliation:read, moadian:inquiries:read, webhooks:manage), ensuring external callers can only create draft or pre-validated vouchers and can never bypass period locks.

Every POST or PATCH mutation to financial endpoints (/v1/vouchers, /v1/invoices, /v1/payments) requires a mandatory Idempotency-Key: <UUIDv4> header, mirroring the Moadian API's requestTraceId pattern (^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$) which rejects duplicate trace IDs with HTTP 400 error 4163. Roxira stores (tenant_id, idempotency_key, request_payload_hash) in Redis (24-hour TTL) and PostgreSQL (idempotency_records). Concurrent duplicate requests receive 409 Conflict (In Progress), completed duplicates return the cached HTTP status and body, and payload mismatches reusing the same key return 422 Unprocessable Entity. Outbound webhooks (invoice.finalized, moadian.status_changed, cheque.maturity_approaching, voucher.posted) are persisted to a transactional outbox table and dispatched by BullMQ workers with exponential backoff up to 72 hours, signed with an X-Roxira-Signature: t=<unix_ts>,v1=<hmac_sha256> header for replay protection. Rate limits are enforced via Redis sliding-window counters at both the Cloudflare/edge layer and NestJS tenant guards, including batch array caps matching Moadian's 100-to-1,000 item limits.

Every organization or developer account can provision an isolated Sandbox Tenant (is_sandbox = true) seeded with sample Jalali or Gregorian financial data. Following the pattern proven by Abrak, external connectors (Moadian, Finotech, Jibit, Zibal, Stripe) inside sandbox tenants automatically bind to deterministic local mock adapters that validate mathematical schemas (Verhoeff taxid, Luhn card, ISO 13616 IBAN) and return realistic simulated responses without making billable network calls. Strongly-typed TypeScript, Python, and C# SDKs are generated automatically from NestJS OpenAPI 3.1 specifications under date-based header versioning (Roxira-Version: 2026-10-01). Crucially, for the Roxira Marketplace, in-process arbitrary code execution inside the NestJS runtime is strictly prohibited; all third-party plugins execute out-of-process via scoped OAuth 2.0 REST APIs, signed webhooks, and declarative JSON UI extensions rendered inside sandboxed iframes.

9. System Architecture, Multi-Tenant Isolation, Sanctions Resilience, and Scale Limits

9.1 Modular Monolith vs. Microservices & Reference Architecture

For an engineering organization operating on a single server today and scaling across two regulatory jurisdictions, a strict Modular Monolith in NestJS paired with an asynchronous Python FastAPI AI Worker Service is architecturally superior to distributed microservices. Splitting core accounting modules (CORE, INV-BILL, STOCK, TREASURY, TAX-IR, PAYROLL-IR) into separate network-isolated microservices would introduce serialization latency, complex distributed two-phase commit failure modes between the General Ledger and FIFO Inventory sub-ledgers, and unnecessary memory overhead on the host. Instead, each domain module is encapsulated as a strict NestJS module communicating via in-process domain services within a single PostgreSQL ACID transaction, while CPU-intensive and I/O-bound tasks (OCR extraction, LightRAG indexing, Moadian cryptographic signing and polling, and .DBF generation) are offloaded asynchronously via BullMQ (Redis) and a Transactional Outbox.

The end-to-end reference architecture across Iran (roxira.ir) and Global (roxira.net) operates across six integrated tiers:

Architectural Layer	Component & Technology Stack	Inbound / Outbound Data Flow	Isolation, Security & High-Availability Mechanism
1. Edge & DNS Layer	• Iran (roxira.ir): ArvanCloud / Sotoon Domestic CDN & WAF (or split-horizon DNS) \rightarrow Domestic Iran Reverse Proxy / Node.
• Global (roxira.net): Cloudflare DNS, WAF, DDoS Protection, Email Routing, R2 Object Storage.	Terminates TLS 1.3; routes static assets from edge cache; forwards /api/* and SSR requests to Next.js / NestJS origin; stores encrypted invoice photos/PDFs and DB backups in S3-compatible object storage.	Protects against Iran National Information Network (NIN) international blackouts (which dropped international traffic by 98% in recent shutdowns) and blocks on Hetzner IP ranges.
2. Presentation & BFF Layer	Next.js App Router (TypeScript, Tailwind CSS, shadcn/ui) + Local PC-POS Bridge (localhost:1024 / WebSocket).	Renders RTL/Jalali (roxira.ir) and LTR/Gregorian (roxira.net) workspaces; streams AI chat responses via SSE; communicates directly from client browser to local Behpardakht/Asan Pardakht POS service on LAN.	Enforces CSP headers, HttpOnly SameSite cookies, and client-side pre-validation (Luhn card check, ISO 13616 Mod-97 IBAN check, Verhoeff check digit).
3. Core Application Layer	NestJS Modular Monolith (Controller \rightarrow Service \rightarrow Repository \rightarrow DTO) + BullMQ Producer/Consumer.	Executes synchronous ACID financial transactions (Journal, Invoicing, FIFO Stock, Payroll, Cheques); writes domain events to Postgres outbox_events table inside the same DB transaction; dispatches async jobs to Redis BullMQ.	Three-layer tenant guard: (1) JWT tid extraction + CASL rule pinning, (2) ORM TenantSubscriber write guard, (3) Scoped transaction wrapper executing SELECT set_config('app.current_tenant_id', $1, true).
4. AI & Statutory Worker Layer	Python FastAPI AI Services + LiteLLM Router + LightRAG (on Postgres) + Qdrant / Zilliz + Moadian / DBF Workers.	Consumes BullMQ queues for OCR invoice drafting, bank reconciliation clustering, LightRAG exemplar retrieval, Moadian JWS/JWE v2 packet signing/inquiry, and Tamin DSKKAR00/DSKWOR00 generation.	Zero direct mutation of core ledger tables; writes strictly to voucher_drafts and ai_audit_logs; enforces tenant_id payload filter on all Qdrant vector searches and LightRAG graph queries.
5. Connection Multiplexing Layer	PgBouncer Sidecar configured in pool_mode = transaction.	Multiplexes hundreds of concurrent NestJS and FastAPI client connections (max_client_conn) over a small warm pool of physical PostgreSQL connections (default_pool_size = (max_connections * 0.8) / db_count).	Prevents PostgreSQL connection exhaustion (max_connections = 100 default) while guaranteeing zero session-state carryover when paired with transaction-local set_config(..., true).
6. Data & Storage Layer	PostgreSQL 16/17 (Primary + WAL Archive) + Redis (BullMQ & Cache).	Stores immutable ledger rows (numeric(20,0) for Rial, numeric(20,4) for decimal currencies), CQRS pre-aggregated account balances, outbox events, and audit logs.	Dual DB roles: app_user (NOBYPASSRLS) for all runtime pools and app_admin (BYPASSRLS) strictly for schema migrations and ops telemetry; FORCE ROW LEVEL SECURITY on all tenant tables.

9.2 Multi-Tenant PostgreSQL Isolation & The PgBouncer + RLS Trap

For a B2B SaaS serving thousands of SMBs and accounting firms, a shared database and shared schema with tenant_id and forced Row-Level Security (RLS) is the most cost-effective and maintainable architecture—while using composite primary and unique keys plus a tenant routing table so large enterprise customers can be siloed into dedicated databases if contractually required.

However, combining PostgreSQL RLS with PgBouncer in transaction pooling mode introduces a severe security trap documented in production engineering benchmarks. If an application sets the tenant context using a standard session-level SET app.current_tenant_id = '...' or set_config('app.current_tenant_id', $1, false), that variable remains active on the underlying PostgreSQL connection after the transaction commits. Because PgBouncer in transaction pooling mode immediately reassigns that physical connection to another client request, any subsequent request path that omits setting the variable inherits the prior tenant's identity. In controlled benchmarks of 400 pooled requests using session-level SET, 187 requests (46.75%) read another tenant's data, whereas zero requests leaked when using transaction-local binding. Furthermore, native PostgreSQL SET LOCAL app.current_tenant_id = $1 fails because PostgreSQL parses SET statements prior to parameter binding.

Consequently, Roxira must enforce four mandatory database isolation rules. First, every tenant-scoped database operation must execute inside an explicit transaction that begins with SELECT set_config('app.current_tenant_id', $1, true). Passing true as the third argument (is_local) scopes the setting strictly to the current transaction—identical to SET LOCAL—and automatically clears it upon COMMIT or ROLLBACK. Second, rather than wrapping every HTTP request in a global NestJS transaction interceptor—which holds pooled connections open during non-database serialization work and inflates PgBouncer wait queues (cl_waiting > 0) at scale—Roxira should use scoped transactions inside service methods (via @nestjs-cls/transactional or a withTenantTransaction(tenantId, fn) wrapper) so connections are checked out from PgBouncer only during active SQL execution. Third, runtime connection pools must authenticate strictly as app_user (LOGIN NOBYPASSRLS) which does not own the tables, while migrations and cross-tenant scheduled jobs authenticate as app_admin (BYPASSRLS) using separate secrets. Every tenant table must enable both ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY, using the fail-closed policy predicate tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid for both USING and WITH CHECK clauses so that an unset variable returns zero rows rather than leaking data.

Fourth, seven PostgreSQL operational details must be enforced across all schemas. Because unique constraints and foreign keys bypass RLS—meaning a global UNIQUE (invoice_number) reveals whether another tenant used a number—all unique constraints and foreign keys must be composite, leading with tenant_id. Similarly, all B-tree indexes must lead with tenant_id (such as (tenant_id, voucher_date DESC)) so the RLS policy predicate becomes an index condition rather than a sequential scan. All SQL views (PostgreSQL 15+) must be created with WITH (security_invoker = true) so they do not execute as the view owner and skip RLS (and PostgreSQL must be kept patched against view/subquery RLS vulnerabilities such as CVE-2024-10976). Engineers must account for LEAKPROOF operator semantics: PostgreSQL evaluates RLS policies before user WHERE clauses unless the operator function is marked LEAKPROOF; equality operators (int8eq, texteq) are leakproof, whereas jsonb @> and LIKE are not. Any custom function referenced in an RLS policy must be marked STABLE rather than VOLATILE so index scans are preserved. Query plan optimization (EXPLAIN ANALYZE) must always be tested after running SET ROLE app_user; because superusers bypass RLS and display unrepresentative plans. Finally, deploy PgBouncer $\ge 1.21$, which natively supports prepared statements in transaction pooling mode, and configure idle_in_transaction_session_timeout to prevent abandoned transactions from locking resources or retaining WAL files.

9.3 Event Sourcing vs. Transactional Outbox, CQRS for Reports, and Audit Logging

Pure Event Sourcing—reconstructing account balances by replaying millions of granular events—complicates ad-hoc relational reporting such as eight-column hierarchical trial balances. Instead, Roxira's architecture rightly uses an append-only, reversal-only relational ledger (journal_vouchers, journal_lines) paired with a Transactional Outbox (outbox_events). Once a voucher is posted (status = 'POSTED'), database triggers (BEFORE UPDATE OR DELETE ON journal_lines) physically block row modifications; adjustments occur exclusively by inserting a reversal voucher linked via reverses_voucher_id.

To serve four-, six-, eight-, and ten-column trial balances in under 50 milliseconds, Roxira should maintain a synchronous Command Query Responsibility Segregation (CQRS) read-model table account_period_balances (tenant_id, fiscal_year_id, jalali_year_month, account_id, tafzili_id, opening_dr, opening_cr, turnover_dr, turnover_cr) updated atomically within the same PostgreSQL transaction that commits a voucher. Generating an eight-column trial balance for any arbitrary month then requires summing at most 12 monthly summary rows per account rather than scanning millions of journal lines. Simultaneously, every state mutation appends a record to an immutable audit_logs table containing tenant_id, actor_id, ip_address, action, before_json, after_json, and a cryptographic hash chain `row_hash = SHA256(prev_row_hash |

| payload)`.

9.4 Encryption, Backups, Disaster Recovery, and the Immediate 20 GB Disk Crisis

Roxira currently operates via Docker Compose on a single Hetzner server with only 20 GB of free disk space remaining. This represents an immediate operational emergency: unbounded Docker container JSON logs, dangling image layers from automated browser smoke test deployments, Qdrant vector write-ahead logs, and PostgreSQL WAL segments (particularly if a replication slot or idle in transaction session stalls WAL recycling) can exhaust 20 GB within hours, crashing PostgreSQL and risking database corruption. On Day 1, the engineering team must attach a 100–200 GB Hetzner Cloud Volume or resize the primary NVMe disk, configure /etc/docker/daemon.json with "log-opts": {"max-si[span_216](start_span)[span_216](end_span)[span_228](start_span)[span_228](end_span)ze": "50m", "max-file": "3"}, schedule daily docker system prune -af --filter "until=72h" jobs, set PostgreSQL idle_in_transaction_session_timeout = '30s', and stream all user-uploaded invoice photos, PDFs, and report exports directly to Cloudflare R2 via pre-signed URLs so zero user media touches local disk.

For cryptographic security, all traffic uses TLS 1.3 in transit, while sensitive tenant credentials—specifically Moadian private keys (private.key), X.509 certificates, and Open Banking tokens (Finotech, Jibit, Zibal)—are protected via AES-256-GCM envelope encryption using per-tenant Data Encryption Keys (DEKs) wrapped by an environment Master Key (KEK), decrypted only in memory during signing. For backups and disaster recovery, local disk dump files must be replaced with pgBackRest or Wal-G streaming compressed, client-side AES-256 encrypted nightly base backups and continuous 60-second WAL segments directly to an Object-Locked Cloudflare R2 bucket, achieving a Recovery Point Objective (RPO) under 5 minutes and a Recovery Time Objective (RTO) under 15 minutes.

9.5 Sanctions, Network Shutdowns, and Hosting Topology: Iran (roxira.ir) vs. Global (roxira.net)

Network telemetry from the last 18 months exposes severe operational hazards when hosting an Iranian SaaS exclusively on a European Hetzner server behind Cloudflare. Cloudflare Radar and IODA measurements confirm that during Iranian internet shutdowns, international connectivity drops by 98% into near-complete blackouts across Tehran, Fars, Isfahan, Alborz, and Razavi Khorasan. Furthermore, network operators document that popular VPS providers—explicitly including Hetzner and DigitalOcean—have their IPv4 and IPv6 address ranges blocked in their entirety by Iranian filtering systems, accompanied by severe public DNS poisoning and SNI blocking. Simultaneously, Iranian government portals (tp.tax.gov.ir for Moadian, es.tamin.ir for Social Security) and domestic Open Banking switches (Finotech, Jibit, Shaparak) operate on Iran's National Information Network (شبکه ملی اطلاعات - NIN) and routinely reject TCP connections from foreign data center ASNs. Conversely, US and EU infrastructure and AI providers enforce strict OFAC and EU sanctions rules, blocking Iranian IP addresses or terminating accounts that route identifiable Iranian financial traffic.

Roxira must therefore transition from a single server to a Two-Cell Deployment Topology. Cell A (roxira.ir — Iran Domestic Production) must be deployed inside an Iranian domestic cloud provider (such as ArvanCloud, Sotoon, or AbrNOC) connected directly to the National Information Network (NIN). When international connectivity in Iran is throttled or shut down by 98%, Iranian businesses on roxira.ir retain uninterrupted, low-latency domestic access to their ERP, PC-POS terminals, Moadian, Tamin, and Finotech/Jibit APIs. For AI capabilities on roxira.ir, the domestic FastAPI worker routes anonymized, PII-stripped extraction payloads through a stateless external AI Inference Relay (or falls back to a domestically hosted open-weights vision/language model during total international blackouts), while streaming encrypted off-site backups asynchronously. Cell B (roxira.net — Global Production) remains hosted entirely on the European Hetzner server behind Cloudflare DNS, CDN, and R2, serving international tenants with zero Iranian network dependency and direct access to global APIs (Stripe, Plaid, Peppol, Groq, Mistral, and Google AI Studio).

9.6 Single-Server Scale Limits and Split Triggers

Once the 20 GB disk constraint is resolved on a standard Hetzner server (e.g., 8 vCPU, 32 GB RAM, 160+ GB NVMe), the single-node Docker Compose stack can support approximately 1,500 to 2,500 active SMB tenants (~150–300 concurrent RPS and 15–25 million journal lines), provided PgBouncer runs in transaction pooling mode (default_pool_size = 40, max_client_conn = 1000) and CQRS summary tables serve trial balance reads. Three quantitative triggers dictate when to split services across multiple nodes: first, split roxira.ir onto domestic Iranian NIN infrastructure immediately (within 30 days) due to Hetzner IP blocking and NIN reachability; second, split Python FastAPI, LightRAG, and Qdrant onto a dedicated AI worker node (or consolidate vector storage into Zilliz Cloud or pgvector) when host RAM exceeds 70% or CPU exceeds 60% during OCR bursts; and third, split PostgreSQL + PgBouncer onto a dedicated database server with a hot standby read replica (hot_standby_feedback = off) when PgBouncer cl_waiting > 0 persists for over 60 seconds, database size surpasses 150 GB, or write throughput exceeds 300 transactions per second.

10. Quality Assurance, Accounting Invariants, Property Testing, and AI Code Governance

10.1 Non-Negotiable Accounting Invariants

Roxira's ledger engine must enforce eight mathematical and state invariants at both the NestJS domain layer and PostgreSQL constraint/trigger layer:

1. Zero-Sum Double-Entry Invariant: For every posted voucher $v$, $\sum_{i \in v} [span_421](start_span)[span_421](end_span)\text{Debit}_i - \sum_{i \in v} \text{Credit}_i = 0$, and for every line $i$, $(\text{Debit}_i > 0 \land \text{Credit}_i = 0) \lor (\text{Credit}_i > 0 \land \text{Debit}_i = 0)$.

2. Exact-Money Integer Invariant: All monetary values are stored and computed as exact integers in minor units (bigint / numeric(20,0) for Rial, where 1 Toman = 10 Rials; bigint minor units for USD/EUR cents). IEEE 754 floating-point (number / float) arithmetic is prohibited in financial calculation paths.

3. Allocation Conservation Invariant: When splitting discounts, VAT, or landed shipping costs across $N$ invoice lines or BOM units, $\sum_{i=1}^N \text{Allocated}_i = \text{TotalToAllocate}$ exactly; any integer division remainder $R$ is deterministically distributed one minor unit at a time using the Largest Remainder Method.

4. Period Lock Immutability: No voucher can be inserted, reversed, or modified with an effective voucher_date falling on or before tenant.locked_until_date.

5. Reversal-Only Correction Symmetry: A posted voucher ($v_1$) can never be updated or deleted; reversing $v_1$ produces $v_2$ where every line $i$ has $\text{Debit}_{v_2,i} = \text{Credit}_{v_1,i}$ and $\text{Credit}_{v_2,i} = \text{Debit}_{v_1,i}$, ensuring a net zero balance impact across $(v_1, v_2)$ at every کل, معین, and تفصیلی level.

6. FIFO Cost Conservation: For every inventory item and warehouse, $\sum \text{Remaining FIFO Layer Values} == \text{GL Inventory Sub-Ledger Balance}$, and no FIFO layer can ever reach remaining_qty < 0.

7. Trial Balance Column Identity: In an eight-column trial balance, for every account $a$: $(\text{Opening Dr}_a - \text{Opening Cr}_a) + (\text{Prior Turnover Dr}_a - \text{Prior Turnover Cr}_a) + (\text{Period Turnover Dr}_a - \text{Period Turnover Cr}_a) == (\text{Ending Dr}_a - \text{Ending Cr}_a[span_217](start_span)[span_217](end_span)[span_229](start_span)[span_229](end_span))$, and the sum of each Debit/Credit column pair across all accounts must be equal.

8. Moadian Invoice Equation Invariant: For every Moadian invoice line, prdis = am * fee, adis = prdis - dis, vam = round(adis * vra / 100), and tsstam = adis + vam + odam, matching the Tax Organization's validation equations to prevent rejection.

10.2 Property-Based Testing with fast-check in TypeScript

Traditional example-based unit tests only verify specific inputs anticipated by the developer, leaving rounding edge cases, multi-line VAT discount prorations, FIFO layer exhaustions, and Jalali leap-year boundaries vulnerable to subtle bugs. Roxira should integrate fast-check (npm install fast-check --save-dev) into its Jest or Vitest TypeScript test suite to execute seeded property-based tests across thousands of randomly generated inputs with automatic counterexample shrinking. Specifically, the suite must test four core properties: first, Voucher and Reversal Round-Trip, generating arbitrary arrays of balanced multi-line bigint vouchers and random reversal subsets to assert that the eight-column trial balance always remains in equilibrium ($\sum \text{Dr} == \sum \text{Cr}$) and matches the sum of unreversed vouchers; second, Discount and 10% VAT Proration Conservation, verifying across arbitrary item quantities, unit fees, and header discounts that line-level tsstam sums exactly to header tbill with zero Rial drift; third, FIFO Inventory Valuation Conservation, generating random sequences of purchase, return, sale, and manufacture stock events to verify that remaining FIFO layer values plus cumulative COGS always equal net purchases; and fourth, Verhoeff Check-Digit Round-Trip, asserting that any generated 22-character Moadian taxid validates as true while any single-character mutation or adjacent transposition validates as false.

10.3 Canonical E2E Tenant Isolation Tests, Load Tests, and Security Standards

Roxira must implement a canonical end-to-end RLS isolation test suite (rls-isolation.e2e-spec.ts) in continuous integration running against a real PostgreSQL and PgBouncer (pool_mode = transaction) container setup. The test seeds two tenants (Tenant_A and Tenant_B) with overlapping voucher numbers and National IDs, connects strictly as the non-superuser app_user (NOBYPASSRLS) role, executes raw unfiltered SELECT * FROM journal_vouchers queries under each tenant context to assert 100% tenant isolation, verifies that omitting set_config('app.current_tenant_id', ...) returns exactly zero rows (fail-closed), confirms that inserting a row with a mismatched tenant_id is rejected at write time by the WITH CHECK policy, fires 500 concurrent interleaved requests through PgBouncer to verify zero cross-tenant connection-pool leaks, and queries pg_class to verify that every table with a tenant_id column has both ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY active.

For load testing, k6 scripts should simulate seasonal tax filing peaks (concurrent Moadian batch submissions, eight-column trial balance queries, and Tamin .DBF exports on the 30th of the month) while monitoring PgBouncer cl_waiting queues. Security controls should align with OWASP Application Security Verification Standard (ASVS) v4.0 Level 2, ISO 27001, and SOC 2 Type II criteria. Finally, because Roxira uses an automated Agent Factory with sandbox, cost budgets, and cross-family review to write code, four CI gates must govern AI-generated pull requests: AI coding agents are blocked from modifying RLS policies, destructive database migrations, or fast-check invariant test files without human cryptographic approval; Stryker mutation testing enforces test effectiveness on core ledger and tax math; cross-family code review prompts a distinct model family with an explicit Accounting and RLS Threat Checklist; and automated Playwright browser smoke tests verify both RTL (roxira.ir) and LTR (roxira.net) workflows prior to deployment.

11. Statutory, Tax, Payroll, and Data Compliance: Iran and Global

11.1 Iranian Tax, Moadian, VAT, and Payroll Rules

Compliance with the Iranian Law on Store Terminals and Moadian System (قانون پایانه‌های فروشگاهی و سامانه مودیان) requires exact adherence to technical and cryptographic standards published on intamedia.ir. Every electronic invoice must carry a 22-character Unique Tax ID (taxid / شماره منحصر به فرد مالیاتی) composed of four fixed-length segments: 6 characters for the Unique Fiscal Memory ID (شناسه یکتای حافظه مالیاتی / fiscalId), 5 characters representing the encoded invoice issuance date, 10 characters for the internal sequential serial number (inno), and 1 check digit (رقم کنترلی) generated via the Verhoeff algorithm. In Moadian API v2, invoice payloads must be signed into a JSON Web Signature (JWS) packet using SHA256withRSA against the taxpayer's X.509 certificate (issued by an authorized Iranian Intermediate CA at gica.ir), and encrypted into a five-part JSON Web Encryption (JWE) envelope using A256GCM for the symmetric payload and RSA-OAEP-256 (using the Tax Organization's public key retrieved via getServerInformation) for key wrapping; any deviation triggers error 04152.

Moadian classifies invoices into Type 1 (inty = 1, full B2B invoices containing the buyer's 11/14-digit Economic Code or National ID, which grant VAT input tax credit once confirmed by the buyer in their portal within 30 days) and Type 2 (inty = 2, B2C retail receipts without buyer identity, which do not grant VAT tax credit) across specialized patterns (inp) including general sales, currency, gold and jewelry, contracting, utility bills, airline tickets, and exports. Every invoice line must include a mandatory 13-digit Goods/Service ID (sstid / شناسه کالا و خدمت) obtained from the Ministry of Industry, Mine and Trade / stuffid.tax.gov.ir. Reference invoices (ins values for Corrective / اصلاحی, Cancellation / ابطالی, and Sales Return / برگشت از فروش) must link to the original 22-character irtaxid. Crucially, buyer identity fields cannot be altered via a corrective invoice, and if 100% of items are returned—or if a buyer rejects an invoice in their portal—the seller must issue a formal Cancellation Invoice (صورتحساب ابطالی), otherwise a buyer-rejected invoice continues to count as taxable revenue for the seller. Invoices must be transmitted within the statutory window (7 days standard, or up to 12 days under administrative grace warnings) in batches not exceeding 100 to 1,000 items.

Under the 1403 and 1404 National Budget Laws (modifying Article 7 of the permanent VAT Law of 1400), the standard Iranian Value Added Tax (VAT) rate increased by 1 percentage point from 9% to 10%, apportioned into a 7% central government share and a 3% municipal and village share. Special statutory VAT rules must be parameterized in Roxira's tax engine: for gold, jewelry, and platinum, the intrinsic metal value is exempt from VAT while the manufacturing wage and seller profit (اجرت ساخت و سود فروشنده) are taxed at 10% in 1404 (up from 9% in 1403); essential imported medicines and medical consumables lacking domestic equivalents are VAT-exempt while pharmaceutical raw materials are taxed at 1%; health-damaging goods (کالاهای آسیب‌رسان such as fast food, sodas, solid oils, and high-fat processed meats) carry a 2% to 10% VAT rate alongside per-stick cigarette and hookah excise taxes; and publishing, medical/rehabilitation, capital market, and Article 81 agricultural activities remain exempt—though Note 1(A) of the 1404 Budget Law mandates that all tax-exempt or zero-rated legal entities still submit full statutory books and tax declarations. In addition, Roxira must track each taxpayer's Authorized Sales Ceiling (حد مجاز فروش, capped at 3x the annual Article 101 exemption threshold unless increased via collateral) and support the mandatory 10% on-account medical withholding tax under Note 1(B) of the 1404 Budget Law.

11.2 International Compliance (roxira.net) and Legal Verification Checklist

For international tenants on roxira.net, the platform must support Peppol BIS Billing 3.0 e-invoicing across Europe and APAC, UK Making Tax Digital (MTD), EU OSS/IOSS VAT returns, and GCC VAT (5% UAE, 15% KSA ZATCA Phase 2), alongside EU GDPR data protection controls (honoring Article 17 Right to Erasure on non-ledger personal profiles while preserving immutable financial vouchers under Article 17(3)(b) statutory retention mandates).

Before scaling commercially across both domains, four items must be formally verified by qualified legal counsel. First, sanctions counsel must verify the corporate registration, beneficial ownership, and billing firewall between roxira.ir and roxira.net so that serving Iranian domestic businesses never exposes roxira.net or its European infrastructure (Hetzner, Cloudflare, Stripe) to OFAC or EU secondary sanctions. Second, Iranian tax counsel must confirm that Roxira's Moadian connector qualifies legally as Direct Taxpayer Submission using the Taxpayer's Own Key (ارسال مستقیم توسط مودی با کل[span_285](start_span)[span_285](end_span)ید مودی) rather than requiring a Trusted Company (شرکت معتم[span_393](start_span)[span_393](end_span)د) license. Third, Iranian cyber and data protection counsel must verify whether routing anonymized OCR crops or encrypted off-site backups outside the National Information Network triggers sector-specific localization restrictions. Fourth, because Iranian tax brackets, Article 100 thresholds (such as the 150x exemption ceiling in Note 1(P) of the 1404 Budget Law), and Tamin parameters change annually via Budget Laws and Supreme Labor Council circulars, all statutory rates must be maintained in an effective-dated statutory_parameters table verified each Esfand.

12. Build, Adopt, or Avoid Matrix (with Licence and Cost)

Component / Capability	Decision	Recommended Tool / Library	Licence	Cost Profile	Architectural Justification
Core Double-Entry Ledger, FIFO & Reversal Engine	BUILD	Native NestJS TypeScript + PostgreSQL bigint/numeric + triggers	Proprietary (In-house)	$0 (Engineering time)	Core IP; must enforce Roxira's exact-money, period-lock, and 8-column hierarchical کل/معین/تفصیلی invariants.
Moadian API v2 Crypto & Verhoeff taxid Engine	BUILD (Reference OSS specs)	Native TypeScript (node:crypto) for JWS RS256 & JWE A256GCM + RSA-OAEP-256 + Verhoeff	Proprietary (Clean-room TS)	$0	CRITICAL LICENCE WARNING: Existing Python Moadian repos (thisiskarimi/moadian, arjavand/moadian) are licensed under GPL-3.0, while Torabi-srh/Moadian (C#) is Apache-2.0. Do not copy GPL-3.0 code into proprietary services; implement clean-room in TypeScript referencing Torabi-srh (Apache-2.0) and official intamedia.ir specs.
Tamin Social Security .DBF Exporter (v6)	BUILD	Custom TypeScript/Python binary .DBF writer for DSKKAR00.DBF & DSKWOR00.DBF	Proprietary (In-house)	$0	Must strictly control Unicode encoding, 8-char Jalali dates, and the 29-column v6 schema (DSW_SPOUSE, DSW_INC).
Database Connection Pooler	ADOPT	PgBouncer (\ge v1.21) sidecar container (pool_mode = transaction)	ISC Licence (Permissive)	$0 (Self-hosted)	Lowest memory overhead on a single VPS; v1.21+ natively supports prepared statements in transaction pooling mode.
Property-Based Testing Framework	ADOPT	fast-check (integrated with Jest / Vitest)	MIT Licence	$0	Industry-standard TypeScript PBT library with seeded arbitraries and counterexample shrinking for accounting invariants.
Iran Open Banking & KYC Inquiries	ADOPT	Finotech, Jibit, Zibal REST APIs via data-driven adapter table	Commercial API	Pay-per-inquiry (~1,000–5,000 Tomans/call passed to tenant)	Pre-configure all 3 providers with sandbox/operational toggle and local Luhn + ISO 13616 Mod-97 pre-validation.
PC-POS Local Hardware Bridge	ADOPT + BUILD	Official PSP Windows Services (e.g., Behpardakht pospc_bpm TCP port 1024) + thin browser/tray adapter	PSP Provided + Proprietary	$0	Avoid writing raw serial/USB drivers; call the PSP's local HTTP/TCP service on port 1024 with 180s timeout.
PostgreSQL Backup & PITR	ADOPT	pgBackRest or Wal-G streaming to Cloudflare R2 / Domestic S3	MIT / Apache-2.0	~$0.015/GB/mo on R2	Replaces local disk backups, provides continuous WAL archiving and point-in-time recovery.
Vector Search Engine	ADOPT (Consolidate)	Qdrant (self-hosted Docker) OR pgvector inside PostgreSQL	Apache-2.0 / PostgreSQL	$0	Avoid running both Qdrant AND Zilliz simultaneously in the current stack; consolidate onto a single vector store (or pgvector with RLS) to save RAM, disk, and sync complexity.
Unconstrained Text-to-SQL & In-Process Plugins	AVOID	Raw LLM SQL generation; arbitrary Node/Python plugin eval()	N/A	N/A	High risk of cross-tenant data leakage, prompt injection, and broken accounting invariants.
Retail Hardware Bloat	AVOID	Proprietary 3D AI barcode cameras, live RFID aisle gates, 8K ad players	N/A	N/A	High support burden and distraction from core financial SaaS.

13. 30, 90, and 180-Day Execution Roadmap with Acceptance Metrics

Horizon	Strategic Focus	Key Engineering & Product Deliverables	Quantitative Acceptance Metrics (Exit Criteria)
Days 1–30: Infrastructure Survival, RLS Hardening & Iran Statutory Core	Eliminate single-server failure risks, lock down multi-tenant isolation, and perfect the Iran statutory wedge (roxira.ir).	1. Storage & DR Remediation: Expand Hetzner disk (\ge 160 GB), cap Docker logs, move all media to R2, deploy pgBackRest continuous WAL archiving.
2. RLS + PgBouncer Enforcement: Migrate all tenant queries to set_config('app.current_tenant_id', $1, true) under app_user (NOBYPASSRLS) with FORCE RLS and composite (tenant_id, ...) indexes.
3. Statutory & Testing Polish: Ship Moadian v2 batch & cancellation/corrective wizard (ins 1–4), Tamin List Disk v6 (DSKKAR00/DSKWOR00[span_311](start_span)[span_311](end_span) with DSW_SPOUSE/DSW_INC), 2/4/6/8-col hierarchical Trial Balances, and fast-check + E2E RLS isolation suites.
4. Iran Domestic Node Prep: Provision domestic NIN reverse proxy/host for roxira.ir to bypass Hetzner IP blocks.	• Free disk space \ge 100 GB; R2 PITR restore drill completed in < 10 minutes.
• 0 cross-tenant leaks across 1,000 concurrent pooled requests in rls-isolation.e2e-spec.ts.
• 100% of tenant tables verified with FORCE RLS in CI.
• 10,000-run fast-check suite passes on Ledger, VAT, FIFO, and Verhoeff taxid.
• DSKKAR00.DBF & DSKWOR00.DBF pass es.tamin.ir v6 validator with 0 format errors.
Days 31–90: Accounting Firm Wedge, Open Banking, PC-POS & Safe Agentic Close	Turn accounting firms into the primary growth engine and automate high-friction treasury and close workflows.	1. Accounting Firm Multi-Client Portal (FIRM-HUB): Ship cross-client compliance matrix, Cmd+K tenant switcher, and wholesale firm billing.
2. Iran Treasury & POS Connectors: Ship data-driven Finotech/Jibit/Zibal Open Banking module (Card-to-IBAN, Sayad 16-digit color inquiry, Shahkar) with local Luhn/Mod-97 checks and Sandbox toggle; ship Behpardakht/Asan Pardakht PC-POS bridge (localhost:1024).
3. Safe Agentic Suite (CloseCopilot & AuditGuardAgent): Ship XML-isolated OCR extraction (prompt-injection safe), visual bounding-box voucher audit evidence, month-end close checklist with AI flux explanations, and hard per-tenant LiteLLM token budgets.
4. Legacy Data Migrators: 1-click guided import from Sepidar, Holoo, and Hesabfa exports.	• \ge 15 Iranian accounting firms onboarded managing \ge 150 client tenants.
• Voucher Drafting Agent achieves \ge 85\% Top-1 GL coding accuracy on repeat vendors and < \$0.08 average LLM cost per active tenant/month.
• 8-column Trial Balance renders in < 150\text{ ms} p95 for a tenant with 500,000 journal lines.
• 100% of invalid card/IBAN strings blocked locally before hitting paid Finotech/Jibit APIs.
Days 91–180: Light Manufacturing (MFG-LITE), Public API Ecosystem & Global Launch (roxira.net)	Expand into Iranian production workshops, open the developer marketplace, and launch international compliance.	1. Assembly & Light Production (MFG-LITE): Ship 1–3 level BOMs, Work Orders, Manufacture Stock Entries, and actual FIFO + overhead unit cost roll-up.
2. Public Platform & SDKs: Ship /api/v1 with hashed API keys, OAuth2 PKCE, mandatory Idempotency-Key, signed outbox webhooks, Sandbox tenants, TypeScript/Python SDKs, and WooCommerce/Digikala connectors.
3. Global Launch (roxira.net): Ship multi-currency FX revaluation, Peppol BIS 3.0 e-invoicing, Plaid/GoCardless bank feeds, Stripe Terminal POS adapter, and complete OWASP ASVS L2 / SOC 2 Type I readiness audit.	• \ge 50 manufacturing/workshop tenants calculating actual BOM unit costs in MFG-LITE.
• 0 duplicate vouchers created under 500-RPS concurrent webhook/API replay testing.
• [span_119](start_span)[span_119](end_span)roxira.ir maintains \ge[span_297](start_span)[span_297](end_span)[span_302](start_span)[span_302](end_span) 99.9\% domestic uptime during international internet throttling events.
• \ge 500 total paying tenants across roxira.ir and roxira.net with Net Revenue Retention (NRR) \ge 115\% via modular upsells.

14. Risks, Unknowns, and Unverified Items

14.1 Top Operational, Technical, and Regulatory Risks

Risk Category	Specific Threat Scenario	Severity	Concrete Mitigation Strategy
1. Infrastructure & Geopolitical	Total or near-complete shutdown of international internet in Iran (98% traffic drop recorded in recent events) or ISP blacklisting of Hetzner IPs severing access to roxira.ir, Moadian, and Finotech.	Critical	Split roxira.ir onto a domestic Iranian NIN cloud host (ArvanCloud/Sotoon) within 30 days; keep roxira.net isolated on Hetzner EU.
2. Immediate Disk Exhaustion	The single Hetzner server has only 20 GB free disk; a burst of container logs, Playwright smoke test artifacts, or unpruned Postgres WALs will crash PostgreSQL.	Critical	Resize volume / attach 160 GB disk on Day 1; enforce Docker log rotation (max-size: 50m); move all file storage and WAL archives to Cloudflare R2; set idle_in_transaction_session_timeout.
3. Cross-Tenant Data Leak	A developer or AI coding agent uses session-level SET instead of transaction-local set_config(..., true) behind PgBouncer transaction pooling, leaking financial data across tenants.	Critical	Enforce set_config('app.current_tenant_id', $1, true) inside scoped transactions; connect as app_user (NOBYPASSRLS); block PR merges unless rls-isolation.e2e-spec.ts passes.
4. Free-First AI Provider Rate Limits & Sanctions Blocks	Free-tier API quotas on Groq, Google AI Studio, SambaNova, or Mistral throttle during end-of-month close peaks, or block requests carrying Iranian IP metadata.	High	Use LiteLLM fallback chains across 6+ providers, cache vendor-to-GL mappings deterministically in Postgres, enforce per-tenant token budgets, and strip all geo/PII metadata at an external inference proxy.
5. Statutory Schema Drift	Abrupt mid-year circulars from the Iranian Tax Organization (intamedia.ir) or Social Security Organization (tamin.ir, such as the v6 DSW_SPOUSE/DSW_INC mandate) invalidate exports.	High	Decouple statutory schemas into versioned, database-driven export templates and effective-dated rate tables; monitor Moadian error telemetry (01xxxx / 04xxxx) in the Operator Console.

14.2 Unknowns and Items Not Verified in Primary Sources

To maintain strict epistemic transparency, four areas could not be verified from public primary sources and require internal inspection or NDA vendor documentation. First, enterprise AI accounting vendors (Vic.ai, Numeric, Trullion, Tabs) and System Group's enterprise Rahkaran tier do not publish standardized public rate cards, relying on custom enterprise quotes; competitive evaluations for those tiers rely on documented volume thresholds (such as 1,000+ monthly invoices for Vic.ai) rather than published list prices. Second, while Roxira's stack confirms NestJS, PostgreSQL, and PgBouncer, the exact ORM (TypeORM, Prisma, or Drizzle) and PgBouncer version inside the repository are not specified; engineering must verify that PgBouncer is $\ge 1.21$ (for transaction-mode prepared statement support) and audit existing repository code for any unsafe session-level SET calls. Third, while Behpardakht Mellat's pospc_bpm service configuration (TCP/IP port 1024, timeout 180000 ms) is verified, complete low-level packet specifications across all 12 Iranian Shaparak PSPs are distributed under merchant NDAs and must be obtained directly from each PSP's technical portal. Finally, while Open Banking aggregators (Finotech, Jibit, Zibal) reliably expose Sayad cheque inquiry endpoints (استعلام چک صیادی), programmatic corporate cheque issuance registration (ثبت چک) and endorsement (ظهرنویسی) face bank-specific multi-signature restrictions that must be verified per partner bank during Phase 2.




Sources used in the report
  قیمت و خرید نرم افزار حسابداری سپیدار همکاران سیستم

  نرم افزار حسابداری پیمانکاری، پروژه و ساختمان سازی سپیدار

  سیستم حسابداری پیمانکاری سپیدار سیستم

  نرم افزار حسابداری و مالی سپیدار | مدیریت مالی دقیق و سودآور

  نرم افزار حسابداری تولیدی سپیدار|1 سال پشتیبانی + دموی رایگان

  21 بهترین نرم‌ افزارهای حسابداری + قیمت + امکانات و ویژگی ها - حسابیز

  نرم افزار دارایی ثابت و مدیریت اموال سپیدار (دمو رایگان)

  نرم افزار انبارداری سپیدار | بهترین نرم افزار انبارگردانی ساده+دمو

  خرید و قیمت نرم افزار حسابداری هلو سوپرمارکت هلوکو

  خرید و قیمت نرم افزار فروشگاهی ابری قیاس 12 ماهه - ترب

  پشتیبان گیری و بازیابی اطلاعات در نرم افزار هلو

  صفحه اصلی - نرم افزار حسابداری و مالی هلو

  وب‌سرویس ابری نرم‌افزار هلو APEX - هلواستور

  بهترین نرم‌افزار حسابداری رایگان | هلو، محک، سپیدار و پارسیان

  هلواستور | راهکارهای هوشمند کسب‌وکار

  فضای ابری چیست و استفاده از آن چه مزایایی دارد - نرم افزار هلو

  بایگانی‌های خبرها - حسابنو - آموزش مالیات و حسابداری

  ارسال لیست - سازمان تامین اجتماعی

  آموزش صفر تا صد تغییرات ارسال لیست سازمان تامین اجتماعی - list disk

  پروژه ایجاد فایل دیسکت بیمه تامین اجتماعی - کارلنسر

  تعریف فایل DBF مربوط به بیمه در نرم افزار مالی نوسا - سامانه

  آموزش گام به گام تهیه لیست بیمه تامین اجتماعی با نرم افزار جدید بیمه

  Python package for Moadian API - thisiskarimi - GitHub

  Iranian tax organization API service moadian (سامانه مودیان) - GitHub

  Tax Collect Data Library Moadian C# کد اتصال به سامانه مودیان - GitHub

  شاپرک-اردیبهشت-1404.pdf - راه پرداخت

  محصولات و خدمات نرم‌افزار - جویشگر

  10 تا از بهترین نرم افزار حسابداری پوشاک 【آپدیت1405】 - حسابدارا

  Best AI Accounting Tools for Finance Teams (2026) - Numeric

  Vic.ai and Oracle Netsuite: AP Solution Guide

  Tech Tuesday: The complete guide to AI accounting agents in 2026

  Guide to AI in Accounting: Use Cases and Looking Ahead | Numeric

  The 16 Best AI Software for Finance and Accounting | Trullion

  حسابداری-مدیریت-اقتصاد-بانکداری و مقالات مربوط

  آموزش کامل نحوه استعلام وضعیت چک صیادی (ثبت، دریافت، انتقال و

  راهنمای کامل و ساده ثبت چک در سامانه صیاد ۱۴۰۴ - Mycredit.ir

  استعلام چک برگشتی با کدملی | سامانه صیاد - پیشخوانک

  سامانه صیاد و مدیریت الکترونیکی چک - ویکی‌پدیا، دانشنامهٔ آزاد

  ساد24 | سامانه اعلام سرقت و استعلام چک بانکی

  خرید سپیدار | تخفیف بسته ها در آبان 1404

  دانستنی‌های حقوق و دستمزد 1404 - سپیدار سیستم

  دریافت گردش حساب | مستندات فنی API

  تراز آزمایشی چیست؟ - تفاوت تراز آزمایشی و ترازنامه| فرداد

  بازرگانی - 2015-1394

  تراز آزمایشی - نرم افزار حسابداری تیپ

  دموی کامل نرم افزار حسابداری سپیدار سیستم - ایران حساب

  dubzzz/fast-check-examples: Property based testing ... - GitHub

  What is Property-Based Testing? - fast-check

  Property-Based Testing with Fast-Check - Gru Singh

  Property-Based Testing in TypeScript with fast-check - Reignark Labs

  Cloudflare misidentifies Hetzner IPs as being located in Iran

  Iran: Internet shutdown from 7 UTC 28 February 2026 #586 - GitHub

  asking for help as an Iranian. : r/AskNetsec - Reddit

  راهنمای اتصال به دستگاه کارتخوان به پرداخت ملت (pc-pos) - زانکو تک

  ‎⁨خدمات نوین امتحان⁩ | PDF - Scribd

  Recipes

  Row-Level Security for Multi-Tenant SaaS in Postgres

  Database Connection Pooling in NestJS: PgBouncer - Matthews Wong

  Top 30 PostgreSQL Interview Questions and Answers [2026]

  Multi-Tenant SaaS Architecture Without Jargon | Design Key

  Postgres Row-Level Security

  Row-level security for multi-tenancy: one shared schema, no cross

  Multi-tenant SaaS in PostgreSQL: schema vs row-level

  GitHub - thisiskarimi/moadian2: پکیج پایتون اتصال به نسخه دوم (با

  کد خطاهای سامانه مودیان و پایانه های فروشگاهی - مالیات من

  سامانه مودیان مالیاتی • چکاد - شیمی پوشش کالا

  آموزش تصویری ثبت نام و ورود به سامانه مودیان مالیاتی - آپاداس

  لیست خطاهای سامانه مودیان - محاسبان

  مهمترین خطاهای سامانه مودیان مالیاتی با راه حل و قابلیت جستجو - Limotx

  سوالات متداول در خصوص صورتحساب الکترونیکی در قانون پایانه های

  ERPNext Manufacturing Management Solution Features - Data Value

  Create and process a Work Order | ERPNext - Frappe Documentation

  Multi-Level BOM in ERPNext (2026): Setup + Costs - Mith.tech

  Bill Of Materials - Frappe Documentation

  Manage Manufacturing with Bill of Materials (BOM) in ERPNext

  Utilizing and Handling Manufacturing in ERPNext v15 - ClefinCode

  Project Costing - ERPNext - Frappe Documentation

  ERPNext for Manufacturing: 5 Critical Problems Solved

  ERP Guide | Manufacturing | ERPNext - Frappe

  استخدام شرکت آسان پرداخت پرشین (اپلیکیشن آپ) | جاب‌ویژن

  e-Invoicing News, May 2026

  استعلام شبا، کارت، چک صیادی و شاهکار در اودو | ابرک

  افزایش مالیات بر ارزش افزوده | قانون جدید و بخشنامه

  مالیات بر ارزش افزوده 1404 + لیست کامل مشاغل مشمول و معاف

  قانون بودجه سال 1404 كل كشور (بخش اول) «سقف منابع عمومي دولت و

  تغییر در نرخ ارزش افزوده از ابتدای سال 1403 - مالیتور

  نرخ 10 درصد مالیات بر ارزش افزوده قانون بودجه 1404 - تازه های حسابداری

  قانون بودجه سال 1404.pdf




Sources read but not used
  سیستم مشتریان و فروش سپیدار همکاران سیستم

  نرم افزار حقوق و دستمزد هلو - کارکرد، فیش حقوقی و بیمه و مالیات

  معرفی 14 تا از بهترین نرم افزار حسابداری در سال 1405+مقایسه

  کد ساخت دیسکت تامین اجتماعی برای سی شارپ سورس - پارس‌کدرز

  List Disk راهنمای نرم افزار - سازمان تامین اجتماعی

  ابزار تغییرات بیمه (پایه سنوات و حق تاهل)

  آموزش ارسال لیست بیمه با نرم افزار لیست دیسک 1405 - بیدبرگ

  آموزش راه اندازی نرم افزار ارسال لیست بیمه نگارش 6 برای تغییرات

  اخبار فین تک – اکوموتیو

  moadian-full 0.0.2 on PyPI - Libraries.io

  Arjavand - GitHub

  Amir Zareian zareianhub - GitHub

  financial-reporting · GitHub Topics

  Masoud Taee mmtaee - GitHub

  شاپرک-بهمن.pdf

  شاپرک-اسفند-1403.pdf

  سند طراحی سیستم مدیریت الکترونیک درآمد زیرسیستم بانک مجازی

  گزارش عملکرد 4 ساله - کیفیت پایین.pdf - سازمان نظام پزشکی

  عنوان گزارش - فروشگاه راه پرداخت

  اسفند 1404 . شماره 129

  Best AI-Powered Accounting Software in 2026 (Reviewed by Experts)

  13 Best AI Tools for Accountants in 2026 (Tested Firsthand)

  چک صیادی چیست؟ نحوه ثبت، دریافت و استعلام آن | شُماران سیستم

  استعلام "زنجیره انتقال چک صیادی" تمامی بانک‌ها | افشای سوابق چک

  آموزش ثبت چک، تایید و انتقال چک صیادی جدید - مجله اینترنتی نوین

  سامانه استعلام چک صیادی - ورانگر | اولین تولید کننده نرم افزار پخش

  استعلام چک صیادی (با کد ملی و شناسه)

  سپیدار سیستم در مجمع عمومی عادی سالیانه ۱۴۰۴؛ چشم انداز روشن با

  قیمت های سپیدار سیستم سال 1404 + لیست قیمت آپدیت بهمن

  کتاب آموزشی سپیدار همکاران سیستم، رایانه کار مالی

  نرم افزار حقوق و دستمزد | محاسبه فیش حقوقی + دمو رایگان

  تراز آزمایشی چیست؟ آموزش کامل تهیه تراز آزمایشی همراه با مثال

  تراز آزمایشی چیست و چگونه تهیه می‌شود؟ + مثال | نوتراز

  آموزش حسابداری از صفر تا بازار کار | دوره عملی حسابداری - کامتک

  بازرگانی - Intern

  fast-check Property-Based Testing for TypeScript - QASkills.sh

  Write a property-based test with TypeScript and fast-check

  Property-based Testing with Fast-check in TypeScript - YouTube

  Property-Based Testing with TypeScript & fast-check - Zenn

  Property-Based Testing in Typescript with Fast-Check - Davide Aversa

  45 FastAPI Interview Questions & Answers with Code (2026)

  PostgreSQL Multi-Tenant Database Architecture: Schema-per

  Best AI for Accountants in 2026: A Privacy-First Ranking - Elephas

  8 Best AI Financial Software: 8 Tools Compared - Rankite

  مرکز تنظیم مقررات، نظام پایاهن اهی فرواگشهی و ساماهن مودیان

  What is Bill Of Materials, its types, and uses? All you need to know.

  GitHub - googool2/moadian-invoice: Claude Code plugin + Agent

  Network & Software Engineer, IT Specialist in Tabriz - Ali Bafandeh

  محاسبه مالیات بر ارزش افزوده با نرخ 10 درصد از ابتدای سال 1403

  نرخ ارزش افزوده کالاهای عمومی در لایحه بودجه سال 1404 - حسابنو

  قانون بودجه سال 1404 كل كشور (بخش اول) «سقف منابع عمومي دولت و




Thoughts
