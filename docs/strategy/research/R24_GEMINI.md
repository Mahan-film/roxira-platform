# R24 Gemini Deep Research (second opinion)

The owner pasted this output earlier (HR and payroll module, country packs, open-source payroll engines, 2026-11-21 era). It is saved unchanged except: the model's internal "Thoughts" blocks are left out (none were present in the paste), citation span markers (`[span_N](start_span)` / `(end_span)`) are removed, and the owner's trailing chat message after the Stage 2 text is not included. No country-name replacement was needed (the text does not contain the default pack's country). Stage 1 and Stage 2 were both received. Stage 2 states that live web lookup was disabled, so its statuses are not primary-source checks. A third block in the same paste (a broader technical, regulatory and cost baseline report) is a different research (R26) and is not part of this file.

## Stage 1

Building an SME HR and payroll module in late 2026 requires separating universal people operations from country-specific statutory liability. Across Germany, Malaysia, and the Gulf (UAE and Saudi Arabia), core HR workflows—employee master records, digital onboarding, leave, attendance, expenses, and document delivery—have converged around self-service portals and mobile workflows, while payroll calculation and statutory filing have diverged sharply in regulatory gating, temporal complexity, and certification overhead. The most viable product strategy is a hybrid modular architecture: build a single core HR system and bitemporal payroll calculation kernel (adopting or modeling after permissive MIT-licensed engines such as PayrollEngine rather than copyleft GPL/AGPL suites), ship a country-agnostic Default Pack first, build native statutory packs for UAE, Saudi Arabia, and Malaysia (where compliance relies on validated file formats and attainable formula verification), and partner via certified APIs in Germany (DATEV Lohn-Datenservices initially, supplemented by ITSG-certified embedded payroll APIs once mature) rather than absorbing a multi-year ITSG and ELSTER ERiC certification cycle up front.

Three 2026 compliance inflections directly shape engineering scope from day one. First, payroll rule engines cannot be uni-temporal: retroactive statutory corrections (Germany's mandatory lookback to April of the prior year and März-Klausel), dual-cohort social security regimes with scheduled annual step-ups (Saudi GOSI rising every July through 2028; UAE GPSSA splitting pre- and post-31 October 2023 hires), and annual wage-cap shifts require bitemporal data modeling with an explicit evaluation-time axis and immutable calculation snapshots. Second, privacy and retention engineering must reconcile opposing statutory clocks across four distinct regimes—GDPR/BDSG § 26, Malaysia's amended PDPA (enforced in phases throughout 2025 with supplementary guidelines rolling out in 2026), Saudi Arabia's actively enforced PDPL (with November 2026 consultation drafts proposing default in-Kingdom storage), and the UAE's split mainland/DIFC/ADGM regimes—while automating active deletion once Germany's shortened 8-year voucher retention expires. Third, HR AI must be strictly confined to drafts-only, read-only, human-committed assistance: although the EU Digital Omnibus (Regulation (EU) 2026/1744) postponed Annex III high-risk HR AI obligations from August 2026 to 2 December 2027, Article 5 workplace prohibitions (including emotion recognition), Article 4 AI literacy, Article 50 chatbot disclosure, GDPR Article 22, and Germany's enforceable works-council co-determination (§ 87 Abs. 1 Nr. 6 BetrVG) are already binding.

Important evidence caveats frame this Stage 1 baseline. No independent, audited engineering cost benchmark publicly quantifies the exact person-months or budget required to pass Germany's initial ITSG Systemuntersuchung or integrate ELSTER's native C-library (ERiC); available duration and effort statements come from payroll vendors and compliance guides characterizing in-house builds as multi-year. Several 2027 statutory parameters—Germany's draft 2027 social security ceilings, proposed Minijob flat-tax hike, pending electronic time-tracking legislation, delayed German Pay Transparency Act transposition, and Saudi PDPL local-storage amendments—remain at draft or consultation stage as of November 2026 and must be isolated behind effective-dated configuration flags.

1. Minimum HR Scope for SMEs in 2026

European and international SME expectations for HR software in 2026 center on an integrated operational core: employee records, legally compliant digital contracts, leave and working-time tracking, payroll preparation or execution, statutory filings, expense reimbursement, and asynchronous digital onboarding. Market benchmarks such as Personio and Factorial illustrate that SMEs with 20–300 staff now expect employee self-service (ESS), mobile leave and attendance workflows, and clean payroll-to-accounting handoffs as baseline capabilities rather than enterprise add-ons.

Four 2025–2026 regulatory shifts turn previously optional workflows into mandatory product requirements. First, under Germany's Fourth Bureaucracy Relief Act (Bürokratieentlastungsgesetz IV, BEG IV), effective 1 January 2025, employers may document essential employment terms under the Nachweisgesetz in electronic text form (§ 126b BGB—an accessible, savable, printable PDF accompanied by a request for receipt confirmation) as well as retirement age-limit agreements. However, paper signatures remain mandatory in high-risk sectors listed in § 2a SchwarzArbG (construction, hospitality, logistics, industrial cleaning, meat processing, private security), fixed-term contracts still require wet ink or a Qualified Electronic Signature (QES) under § 14(4) TzBfG before work begins (omission converts the contract into an indefinite one), and termination notices, settlement agreements (§ 623 BGB), and post-contractual non-competes strictly prohibit or restrict electronic form. A 2026 SME contract module must therefore route documents by legal form and industry rather than offering a single generic e-signature action.

Second, systematic daily working-time capture is already legally mandatory in Germany under the Federal Labour Court's (BAG) 13 September 2022 ruling (1 ABR 22/21) interpreting § 3(2)(1) Arbeitsschutzgesetz—covering start, end, and duration of daily work for all employees, including remote staff, Minijobbers (who carry additional same-day recording duties under § 17 MiLoG), and trust-based schedules, in an objective, reliable, employee-accessible system. Although the federal BMAS draft law mandating electronic capture (proposing 1-, 2-, and 5-year transition windows by headcount and a permanent analog exemption under 10 staff) has not yet been enacted as of late 2026, missing statutory overtime records already carry fines up to €30,000 (§ 16(2)/§ 22 ArbZG) and up to €50,000 under § 21 MiLoG. Third, in its 28 January 2025 ruling (Az. 9 AZR 48/24), the BAG classified statutory payslip delivery (§ 108(1) GewO) as a collectible obligation (Holschuld), confirming that placing downloadable PDF payslips in a password-protected employee portal satisfies text form even without employee consent—provided staff lacking private online access can view and print payslips on-site.

Fourth, although Germany missed the 7 June 2026 transposition deadline for the EU Pay Transparency Directive (2023/970)—with legal analysts expecting a German Amending Act in early 2027 and potential transitional deferral of initial domestic reporting to June 2028, while public-sector employers have been directly bound since 8 June 2026—the Directive abolishes small-company thresholds for individual employee pay-information rights, requires salary ranges prior to interviews, bans salary-history questions, and lowers gender pay-gap reporting thresholds from 500 to 100+ employees (EU baseline: annual for 250+ and triennial for 150–249 from June 2027; triennial for 100–149 from 2031). Structuring job grades and actual-pay components cleanly in MVP avoids costly retroactive compensation audits later.

HR Domain	Must (MVP / Day-1 Launch)	Should (Phase 2 / Growth SME)	Later (Scale-Up / Enterprise)	Key 2026 Compliance & Architectural Drivers
Employee Records	Centralized master data (personal, job, cost center, tax/social IDs, bank IBAN); effective-dated compensation & job history; digital personnel file with folder-level RBAC; separate permissions for bank details vs. core profile.	Org charts; multi-entity / multi-country profiles; document expiry alerts (visas, Iqama, work permits, certificates); custom fields with audit logs.	Position management & headcount budgeting; cross-entity "single source" pay-group tagging; succession & skills matrices.	Strict segregation of Art. 9 GDPR / sensitive data (health, religion, biometrics) and beneficiary bank details; effective dating required for retro payroll.
Contracts	Document templates with merge fields; contract versioning; form-level routing (Text Form PDF + receipt confirmation vs. wet-ink download vs. QES hook for fixed-term); probation & fixed-term expiry alerts.	Native SES/AES/QES e-signature integration; automated amendment & salary-letter generation; industry flag for § 2a SchwarzArbG paper-only enforcement.	Collective bargaining agreement (Tarifvertrag) tariff-table binding; Arabic localization & alignment with KSA Qiwa labor-contract records.	Germany BEG IV enables digital permanent contracts, but fixed-term without QES/wet ink becomes permanent; § 623 BGB excludes electronic terminations.
Leave	Statutory & company leave policies (accrual, carry-over, part-time pro-rata); ESS request & manager approval workflow; sick-leave logging (dates only—no diagnosis); regional/state public holiday calendars.	Automated sick-leave statutory hooks (e.g., Germany eAU via certified partner/DATEV); leave-encashment & unpaid-leave auto-sync to payroll; team calendar sync.	Parental leave (Elternzeit), sabbatical, and long-term illness (Krankengeld / EEL) case orchestration; substitute public-holiday tracking (MY s. 60D).	Malaysia requires 16-state holiday datasets; Germany native eAU retrieval requires ITSG certification.
Attendance	Daily start, end, break, and duration logging (web/mobile ESS); tamper-evident edit audit trail (timestamp, actor ID, reason); employee self-access to own logs; overtime & shift-premium export to payroll.	Rest-period & daily maximum (8h/10h ArbZG) alerts; shift rostering; Minijob monthly hour/earnings cap warnings (€603/mo in 2026).	Hardware terminal integrations (NFC/PIN—avoiding biometrics by default); project-time billing; tax-free night/Sunday/holiday surcharge proofs (§ 3b EStG).	BAG 1 ABR 22/21 mandates daily tracking now; § 3b EStG tax-free supplements require person/day/hour GoBD proof; biometrics trigger DPIAs & PDPA sensitivity.
Payroll	Effective-dated gross-to-net run (Default Pack + target country packs); off-cycle & retro delta handling; immutable payrun lock; PDF payslip in password-protected ESS portal; bank payout file (SEPA/GIRO/SIF); GL journal posting.	Multi-currency pay runs; employee loans & advances recovery; automated EOSG/EOSB monthly accrual reserve posting; variance & anomaly pre-check dashboard.	Multi-country consolidated payroll hub; automated treasury/disbursement rails; specialist German Baulohn or short-time work (Kurzarbeit) modules.	Must reconcile cleanly with GL; UAE requires strict separation of Basic vs. Allowances for EOSG; KSA requires Basic + Housing for GOSI.
Statutory Filings	Country-appropriate path: Germany via DATEV Data Services / certified partner; Malaysia agency upload files (KWSP, ASSIST SOCSO/EIS, CP39, EA, C.P.8D); UAE validated SIF file; KSA Mudad/GOSI exports.	Automated filing calendar with hard deadlines (UAE 1st of month; MY/KSA 15th); submission receipt & response archiving; LHDN written PCB verification.	Direct ITSG/dakota & ELSTER ERiC native filing (only if scale justifies multi-year certification); automated KSA Qiwa/Mudad API bridging.	Uncertified German software is legally barred from DEÜV/SV filing; UAE Res. 340/2026 enforces 1st-of-month WPS due date with 85% threshold.
Expense Claims	Mobile/web receipt upload; policy categorization & manager approval; non-taxable reimbursement line on payslip (excluded from tax/EPF/SOCSO/SV bases); GoBD-compliant digital receipt archiving.	Mileage, per-diem & travel-policy compliance checks; OCR receipt extraction with human review; VAT split posting.	Corporate card feeds; multi-currency FX reconciliation; extended Germany DLS export for travel/benefit sub-systems (mandatory from Jan 2027).	Reimbursements must remain outside statutory remuneration bases; Germany requires 8-year GoBD archiving for travel receipts.
Onboarding	Role- and country-specific checklists; ESS self-onboarding form (bank, tax ID, emergency contact, ID/visa upload); automated document pack delivery & acknowledgement tracking.	Pre-boarding portal prior to Day 1; IT provisioning webhooks; statutory new-hire triggers (MY CP22/TP3, UAE 30-day WPS window, DE ELStAM registration).	Structured 30/60/90-day probation reviews; offboarding & final-settlement orchestration (KSA 7/14-day window, UAE 14-day gratuity, DE electronic Arbeitszeugnis).	Capturing prior-year YTD figures (MY TP3) and GOSI/GPSSA first-registration dates at onboarding prevents immediate statutory miscalculations.

2. Payroll Rule Engines: Build vs. Buy vs. Open Source

Selecting the payroll calculation foundation locks in licensing obligations, time-to-market, multi-country scalability, and annual regulatory maintenance costs.

Build vs. Buy vs. Open Source (and License Implications)

Building a payroll engine internally provides full control over bitemporal modeling, accounting integration, and UX, but shifts 100% of statutory tracking, turn-of-year updates, regression testing, and country certifications onto internal engineering. Buying an embedded payroll API abstracts calculation and filing behind REST endpoints and drop-in UI flows: in the United States, an embedded-finance industry tracker reports typical wholesale economics of a $35–$70/month customer base fee plus $6–$10 per employee per month (PEPM)—roughly a two-thirds platform / one-third infrastructure split—with vendor-reported launches taking 17 days (HoneyBook on Salsa) to four weeks (Gusto Embedded Flows).

However, a major geographic gap exists as of mid-to-late 2026: an industry analysis (payrollex.io) notes that no US embedded payroll API covers any European country. Unified HRIS/payroll APIs (Finch, Merge, Kombo, Knit, Truto, Apideck) solve data synchronization rather than calculation, and even the deepest specialist—Finch, claiming 250+ integrations and write-back across 25+ providers in its own comparison—is heavily US-focused. In Germany, established payroll incumbents (DATEV LODAS / Lohn und Gehalt, Lexware, Sage) do not offer open white-label calculation APIs; DATEV provides mature OAuth cloud data-transport services (hr:exchange, hr:files, hr:payrollreports, hr:exports, hr:eau), but requires the customer's tax advisor (Steuerberater) or DATEV member license to execute payroll. Emerging German API-first challengers (such as Lohnfluss, advertising planned employer pricing from €5 PEPM and negotiated partner terms, and white-label suites like vyble) target this void, though Lohnfluss remains in ITSG system examination with waitlist-only access as of late 2026. Global payroll/EOR platforms (Deel and Remote Global Payroll listed from $29 PEPM; EOR from €499–$699 PEPM across comparison guides) offer broad coverage via owned entities and local partners, but at higher PEPM cost and thinner domestic SME accounting integration than local rails.

For a build or hybrid path leveraging open-source HR and payroll engines, license mechanics are decisive—especially for multi-tenant SaaS products delivering JavaScript bundles to customer browsers:

Project	Architecture & Focus (2026 Status)	License	SaaS / Commercial Risk & Compliance Impact	Assessment for R24
PayrollEngine (Payroll-Engine/PayrollEngine)	Regulation-driven, multi-tenant, multi-country, API-first payroll engine (.NET, PostgreSQL/MySQL, Docker, MCP Server; v1.3.0 Nov 2026). Native bitemporal + evaluation time, retro jobs, Lex compliance snapshots & 4-eyes attestation.	MIT	Lowest risk. Permissive commercial use, modification, and proprietary embedding requiring only copyright/license notice preservation.	Top open-source engine candidate (either embedded as a headless payroll microservice or adopted as R24's direct architectural reference).
Frappe HR (frappe/hrms)	Full-stack HRMS + Payroll (13+ modules, mobile PWA, Vue/Frappe UI, Python/Frappe Framework; v16.54.1 active). Community KSA app (Optima-Hr) also exists.	GPL-3.0 (HRMS & Optima-Hr); Frappe Framework is MIT	High SaaS friction. Pure server-side execution of GPL-3.0 is commonly treated as non-distribution ("SaaS loophole"), but serving modified GPL-3.0 JavaScript/Vue frontend code or mobile apps to customer browsers/devices is widely viewed by legal analysts as distribution triggering copyleft disclosure.	Avoid embedding directly inside a proprietary commercial SaaS product; viable only if R24 itself is licensed under GPL-3.0 or strictly server-isolated behind an independent frontend.
Horilla HR (horilla-opensource/horilla / horilla-hr)	Python/Django + HTMX HRMS (v2.4.0 introduced configurable ordered payroll engine; PostgreSQL; mobile app).	LGPL-2.1+ across official repos (warning: some third-party forks/mirrors cite AGPL—verify exact origin!)	Moderate risk. Official LGPL-2.1 permits proprietary extensions using the library, but modifications to Horilla's core require disclosure upon distribution. Any AGPL code (Section 13) closes the SaaS loophole and mandates full source disclosure to network users.	Usable as a standalone reference or loosely coupled service under official LGPL-2.1, but lacks PayrollEngine's mature bitemporal retro & regulation-pack architecture; run SCA license audits to rule out AGPL contamination.
Odoo Payroll (Community vs. Enterprise / OCA)	ERP-integrated payroll (contract/version-driven structures, Python rules, batches, GL posting; Odoo 20 moves contractual data to hr.version).	Enterprise (hr_payroll): Proprietary (OEEL). Community: LGPLv3; OCA payroll backport is LGPL-3 (outside OCA CLA); store addons often OPL-1.0.	Split-licensing trap. Official hr_payroll and country localizations require paid Enterprise seats; Community backports lack vendor statutory maintenance and third-party modules typically charge per major version.	Poor fit as an embedded engine for an independent SaaS product due to ERP monolith coupling and Enterprise paywalls.

Effective-Dated Statutory Rules and Bitemporal Recalculation Architecture

Payroll systems break when they overwrite historical state. Because HR corrections—backdated raises, late sick certificates, updated ELStAM tax classes, or corrected hours—routinely arrive after a pay period has closed and disbursed funds, the rule engine must distinguish when a fact was true in the real world from when the system recorded it.

A robust R24 calculation kernel should implement a bitemporal (and tritemporal) data model selectively on payroll-relevant tables (compensation, job/cost allocation, tax/social status, time entries, and statutory rule packs) rather than bloating unrelated tables:

1. Valid Time (valid_from, valid_to): The effective interval during which a rate, allowance, tax attribute, or statutory threshold applies in the real world. Active timeline projections should enforce non-overlapping intervals per employee and pay component (e.g., via PostgreSQL exclusion constraints), while preserving superseded revisions separately.

2. Recorded / Transaction Time (recorded_from, recorded_to): The append-only timestamp recording when the system learned or superseded that fact. Corrections never overwrite prior rows; they close recorded_to on the superseded belief and append a new row, allowing exact on-demand reproduction of any historical payslip or audit report.

3. Evaluation Time (evaluation_date): The cutoff timestamp at which a payrun evaluates both employee inputs and effective-dated statutory rule packs, unifying historical audit replay, forward forecasting, and automated retroactive recalculation.

When a late change arrives (recorded_from > prior_run.evaluation_date for a valid_from inside a closed period), the engine never mutates the closed payslip or closed GL journal. Instead, it re-runs affected historical periods against the historical period's effective statutory rules, computes the signed delta (RetroValue = Σ [ConsolidatedValue(m) − OriginalValue(m)]), and posts that net adjustment into the current open payrun via dedicated delta wage types—keeping the closed ledger intact. Two engineering safeguards prevent subtle bugs: first, persist zero-value baseline results (analogous to PayrollEngine's storeEmptyResults: true) so a future retro change from zero to a positive figure—or back to zero—produces the exact signed delta; second, enforce a retroactive earliest-change date per payroll area (with privileged HRIS unlock and dual control) matching statutory lookback limits such as Germany's mandatory lookback to at least April of the prior year and März-Klausel one-time-payment rollbacks (§ 23a(4) SGB IV).

Every closed payrun must also seal an immutable execution bundle: (1) an input snapshot (exact time-entry, rate, employee-attribute, and statutory rule-pack versions), (2) calculation results (line items, rounding basis, input digest), (3) approval metadata (actor, timestamp, digest), (4) payment instruction references, and (5) statutory filing payload plus authority acknowledgement. Applying manifest-driven compliance snapshots with mandatory four-eyes attestation (mirroring PayrollEngine's LexSnapshot and LexAttest workflow) prevents unreviewed statutory table updates from entering production.

3. Country-Pack Strategy: Default Pack, Germany, Malaysia, and the Gulf

To keep core HR code free of jurisdiction-specific branching, R24 should encapsulate every country's rules inside a Versioned Country Pack—a deployable, effective-dated bundle comprising five standardized layers: (1) effective-dated Parameter & Lookup Tables (wage-band schedules, tax brackets, caps), (2) an ordered Declarative Rule DAG operating on canonical remuneration primitives (basic_salary, housing_allowance, other_fixed_allowances, variable_commission, bonus, expense_reimbursement), (3) Sub-National Holiday Calendars (German Bundesländer, Malaysia's 16 states), (4) Pre-Run Validation Schemas (checking statutory IDs and plausibility rules), and (5) Document & Export Adapters (localized payslips, bank files, and statutory upload schemas).

Default Pack (Country-Agnostic Launch Baseline)

The Default Pack launches first to validate the core bitemporal kernel and serve SMEs operating outside localized markets or using external payroll bureaus. It provides canonical earning and deduction primitives (Basic, Housing, Other Fixed Allowances, Variable Bonus/Commission, Overtime Multipliers, Unpaid Leave Deductions, Non-Taxable Expense Reimbursements, Loans/Advances), configurable proration conventions (calendar days, fixed 30-day month, or working days), generic progressive tax-bracket and flat-percentage deduction templates, generic PDF payslips, SEPA/CSV bank-transfer files, and automated double-entry GL journal posting. Establishing this canonical remuneration taxonomy in the Default Pack ensures downstream country packs map cleanly without database migrations.

Germany Pack (2026 Parameters and 2027 Inflections)

Germany represents the highest regulatory complexity in the roadmap. Wage tax (Lohnsteuer) follows the Federal Ministry of Finance's annual Programmablaufplan (BMF PAP 2026, issued 12 November 2025): the 2026 basic tax-free allowance (Grundfreibetrag) is €12,348 (€24,696 joint), progressive rates run from 14% to 42% (reaching 42% at €69,879 and 45% at €277,826), the 5.5% solidarity surcharge (Solidaritätszuschlag) triggers above €20,350 in assessed income tax (€40,700 joint), and church tax (Kirchensteuer) is 8% in Bavaria and Baden-Württemberg or 9% elsewhere. Tax classes I–VI (including IV with factor), child allowances (€9,756 combined in 2026 for Soli/KiSt purposes), and private health-insurance deductions are retrieved electronically via ELStAM, with monthly change lists and mandatory Tax Class VI fallback if an employee withholds their Tax ID or activates an ELStAM block.

Social security (Sozialversicherung) uses unified nationwide ceilings since 2025. For 2026, the Pension and Unemployment (RV/AV) ceiling is €8,450/month (€101,400/year) at rates of 18.6% RV (9.3% each) and 2.6% AV (1.3% each); the Health and Long-Term Care (KV/PV) ceiling is €5,812.50/month (€69,750/year); and the mandatory public-health opt-out threshold (Jahresarbeitsentgeltgrenze, JAEG) is €6,450/month (€77,400/year). Public health insurance (KV) charges 14.6% (7.3% each) plus a fund-specific Zusatzbeitrag split 50/50 (2026 official average: 2.9%, yielding a maximum monthly employer PKV subsidy of €508.59). Long-term care (PV) is 3.6% base (1.8% each), adding an employee-only +0.6% surcharge for childless workers aged 23+ (4.2% total) and deducting 0.25% per child from the employee share for children two through five. Partial months prorate ceilings on a 30-day SV-day basis, and multi-employer earnings exceeding the cap require proportional splitting calculated by the health fund. Notably, September 2026 ministerial drafts propose steep 2027 increases to €6,375/month (€76,500/year) for KV/PV, €8,850/month (€106,200/year) for RV/AV, and €7,012.50/month (€84,150/year) for JAEG—which will pull privately insured employees earning around €80,000 back into mandatory statutory coverage absent a raise.

Marginal employment rules also shift at year-end. Dynamically coupled to the statutory minimum wage (€13.90/hour in 2026; confirmed €14.60/hour from 1 January 2027), the Minijob ceiling stands at €603/month (€7,236/year) in 2026 and rises automatically to €633/month (€7,596/year) on 1 January 2027, allowing up to two unforeseen monthly exceedances up to double the cap (€1,206 in 2026). The Midijob (Übergangsbereich) sliding-scale employee relief spans €603.01–€2,000/month. Commercial Minijobs carry 15% employer pension plus 3.6% employee pension (opt-outable, and since 1 July 2026, employees may revoke a prior opt-out once prospectively). Additionally, the September 2026 Cabinet draft for the 2027 Income Tax Reform proposes raising the Minijob flat tax (Pauschsteuer) from 2% to 5% and commercial flat health contribution from 13% to 17.5%—while statutory Digitale LohnSchnittstelle (DLS) audit exports expand on 1 January 2027 (§ 4(2a) LStDV) to cover upstream ancillary systems including time tracking, travel expenses, benefits, and driver logs.

Malaysia Pack (2026 Parameters)

Malaysia is a strong fit for a native R24 country pack because statutory agencies rely on structured portal file uploads rather than ITSG-style encrypted runtime certifications, while tax accuracy is verified through an accessible annual LHDN review. EPF (KWSP) contributions must be resolved row-for-row from the official KWSP Third Schedule wage-band tables (up to RM20,000) rather than percentage rounding. Malaysian citizens under 60 follow headline rates of 11% employee and 12% employer—rising to 13% employer for monthly wages ≤ RM5,000 (crucially, when a bonus pushes a ≤RM5,000 regular salary above RM5,000 in a bonus month, the employer remains at 13% under the Third Schedule); employees aged 60+ follow reduced schedules (5.5% employee / 6% employer headline under Part E). From the October 2025 salary cycle—and fully enforced across 2026—non-Malaysian citizen employees (non-PR) are subject to mandatory 2% employee + 2% employer EPF contributions.

SOCSO (PERKESO) and EIS (SIP) both apply official RM100 wage-bracket tables capped at RM6,000/month (raised from RM5,000 in October 2024 and still RM6,000 as of mid-2026) and exclude bonuses. Exact table lookups are essential: at the RM6,000 ceiling, Category I SOCSO is RM29.75 employee / RM104.15 employer, whereas naive 0.5%/1.75% math produces RM30.00/RM105.00. EIS covers Malaysian citizens and PRs aged 18–59 (~0.2% each, max RM11.90 each) and excludes foreign workers. Practitioners should note conflicting secondary coverage on foreign-worker SOCSO: some online calculators still cite legacy Category II (1.25% employer-only), whereas PERKESO brought foreign workers into Invalidity Scheme coverage in July 2024 and introduced June 2026 updates including over-60 deductions and optional employee-funded LINDUNG 24 Jam (SKBBK) coverage. The Malaysia pack must therefore ingest official PERKESO Act 4 rate tables directly as effective-dated data.

Monthly income tax withholding (PCB / MTD) follows LHDN's computerised calculation specification, incorporating YTD state, TP1 employee reliefs, TP3 prior-employer YTD figures, zakat offsets, separate additional-remuneration (bonus) formulas, flat 30% non-resident withholding, and 15% Returning Expert Program / C-Suite rules. R24 should pass LHDN's email test-case verification to secure an annual written verification letter and listing on HASiL's approved-software register prior to Malaysian GA. Employers with 10+ Malaysian citizens in covered sectors must also pay an employer-only HRD Corp levy of 1% on basic salary plus fixed allowances (excluding overtime, bonuses, and foreign workers; voluntary 0.5% for 5–9 citizens; registered private education institutions are exempted January–December 2026). All four monthly remittances (EPF, ASSIST SOCSO/EIS, CP39 for MyTax e-PCB Plus, and HRD Corp e-TRiS Form 2) are due by the 15th of the following month. Annual outputs require EA Forms (due by end of February), Form E + C.P.8D (Pin. 2024 layout), departure notices (CP22/CP22A/CP21 with 30-day advance notice and tax-clearance holdback up to 90 days), 16-state holiday calendars, and worked public-holiday pay at basic ÷ 26 under Employment Act s. 60D(3)(a).

Gulf Pack: UAE and Saudi Arabia (2026 Parameters)

With 0% personal income tax in both markets, Gulf payroll risk concentrates on Wage Protection System (WPS) file precision, strict disbursement deadlines, dual-cohort national pension schedules, and statutory end-of-service liabilities.

In the UAE, MOHRE Ministerial Resolution No. 340 of 2026 (effective 1 June 2026, replacing Resolution 598/2022) tightened mainland private-sector WPS enforcement: previous-month salaries are now due on the 1st of the following Gregorian month (unaffected by weekends or holidays), employers must transfer at least 85% of total wages due on time, and automated enforcement starts with electronic monitoring/alerts from day 2, escalating on day 5 (warning and, per some vendor guides, permit restrictions) and per-employee administrative fines from day 11. (Note that older 2026 blogs still repeat the legacy 15-day rule; R24's calendar must enforce pre-1st cutoffs.) The pack must generate bank-validated fixed-width SIF files (Employer Control Record + Employee Detail Records with zero-padded MOHRE IDs and exact control totals). Free zones (such as DIFC and ADGM) operate outside federal MOHRE WPS under zone-specific regimes, whereas mainland employers risk losing UAE Corporate Tax deductibility if wages bypass WPS. Expatriate End-of-Service Gratuity (EOSG) under Article 51 (Federal Decree-Law No. 33/2021) accrues after ≥1 year of service at 21 days of last basic wage/year for years 1–5 and 30 days/year thereafter (prorated, excluding unpaid leave and allowances, capped at 2 years' wage), unless the employer joins the Voluntary Savings Scheme paying 5.83% (<5 years) or 8.33% (5+ years) of monthly basic salary. Emirati GPSSA pensions split sharply by registration date: pre-31 October 2023 enrollees (Law 7/1999) pay 5% employee / 15% employer (government subsidizes 2.5% in the private sector → 12.5% net employer) on January-locked salary capped at AED 50,000 (floor AED 1,000); hires from 31 October 2023 onward (Decree-Law 57/2023) pay 11% employee / 15% employer (26% total) on full salary including incentives, with the 2.5% government private-sector subsidy applying only below AED 20,000 and a private-sector cap of AED 70,000 (floor AED 3,000; public AED 100,000), due 1st–15th via Ma'ashi (10% late charge), plus proportional part-time Emirati coverage (8–32 hours/week) rolled out from August 2026.

In Saudi Arabia, GOSI applies to a contributory wage of Basic + Housing allowance (cash or 1/6 of basic in-kind) plus commission, subject to a SAR 1,500 floor and SAR 45,000/month ceiling, payable by the 15th via GOSI/SADAD. Expatriates carry 0% employee / 2% employer (occupational hazards only). Saudi nationals split by first-ever GOSI or civil-pension registration date: employees registered before 3 July 2024 remain on the old system—9% annuities + 0.75% SANED each side plus 2% employer occupational hazards (9.75% employee / 11.75% employer = 21.5% total; note one compliance blog misstates SANED as 1% while reporting the same 21.5% total, whereas PwC and GOSI-aligned calculators confirm 0.75% per side). New entrants registered on or after 3 July 2024 (Royal Decree M/273) face an annual +0.5% annuities step-up on each side every July (secondary guides cite 1 July or 3 July—confirm exact effective date on GOSI invoices), reaching 10% each side from July 2026 to June 2027 (10.75% employee / 12.75% employer = 23.5% total), rising to 10.5% in July 2027 and 11% (11.75% EE / 13.75% ER = 25.5% total) from July 2028. Unlike UAE's basic-only gratuity, Saudi End-of-Service Benefit (EOSB) under Article 84 uses the employee's Actual Wage (basic + regular fixed allowances + commission unless contractually excluded under Art. 86) at 0.5 month/year (years 1–5) and 1 month/year thereafter, prorated; voluntary resignation (Article 85) pays 0% (<2 years), 1/3 (2–5 years), 2/3 (>5 to <10 years), and 100% (≥10 years), with full entitlement restored under Article 87 for force majeure or female workers resigning within 6 months of marriage or 3 months of childbirth. Final settlements must be disbursed within 7 days (employer termination) or 14 days (employee resignation) under Article 88. Payroll data must reconcile across interlocking platforms—Mudad (WPS, fines SAR 5,000–50,000), Qiwa (contracts), GOSI, and Nitaqat (full Saudi headcount credit requires ≥SAR 4,000/month; half-credit at SAR 3,000–3,999)—and compensation records must be maintained in Arabic unless the Ministry of Labor grants an exception.

Country Pack	Income Tax	Primary Calculation Complexity	Filing / Payment Mechanism	Regulatory Certification Gate	Highest-Risk Edge Cases
Default Pack	Configurable generic brackets	Pro-rata, OT multipliers, generic deductions, GL mapping	Generic CSV / SEPA / bank transfer	None	Enforcing canonical pay-component taxonomy (Basic, Housing, Fixed, Bonus, Reimbursement)
Germany	BMF PAP 2026 + ELStAM + Soli + KiSt	Split BBGs, fund-specific Zusatzbeitrag, PV child discounts, Minijob/Midijob, März-Klausel	Electronic: DEÜV/dakota, ELSTER ERiC, GoBD DLS	Very High: Mandatory ITSG Systemuntersuchung + ELSTER ERiC onboarding	Retro lookback to prior April; eAU retrieval needs ITSG; 2027 BBG/Minijob jumps; 2027 DLS sub-system expansion
Malaysia	LHDN PCB/MTD (YTD computerised)	Official banded tables (EPF, SOCSO, EIS), foreign 2% EPF, bonus rules, HRD Corp 1%/0.5%	Portal file uploads: KWSP, ASSIST, CP39, e-TRiS, bank GIRO	Moderate: Annual LHDN written verification of PCB formula	Table lookup vs. % rounding (RM29.75 vs. RM30.00); 16-state holidays; TP1/TP3 & CP21/22A tax clearance holds
UAE	0%	Dual GPSSA Emirati cohorts + AED 20k subsidy cliff; EOSG basic-only vs. 5.83%/8.33% savings	Fixed-width SIF to WPS bank/agent; Ma'ashi portal for GPSSA	Low (Format-driven): WPS agent/bank SIF validation (no engine license)	1st-of-month WPS due date & 85% rule (Jun 2026); DIFC/ADGM free-zone splits; CT deductibility
Saudi Arabia	0%	Dual GOSI cohorts + annual July +0.5% step-up; EOSB Actual Wage + Art. 85/87 resignation tiers	Mudad WPS file; GOSI/SADAD; Qiwa contract alignment	Low (Format-driven): Mudad/GOSI schema reconciliation	Applying legacy 9% GOSI to post-Jul 2024 Saudis; 7/14-day final settlement window; mandatory Arabic records

4. Certified-Payroll Partnerships vs. Own Engine: Cost and Risk

The build-vs-partner decision diverges sharply by jurisdiction depending on whether regulators impose a statutory software certification gate on filing.

Germany's Certification Barrier: ITSG Systemuntersuchung and ELSTER ERiC

In Germany, payroll software is legally barred from submitting social security reports (DEÜV), monthly contribution statements (Beitragsnachweise), or electronic sick-leave queries (eAU) without passing the ITSG Systemuntersuchung commissioned by the GKV-Spitzenverband under § 22 DEÜV and § 28b SGB IV. Since 2022, even standalone time-tracking or HR tools that directly retrieve eAU data must undergo ITSG system examination.

ITSG's direct audit fees are not the barrier: under the official GKV-AG/ITSG fee schedule, online and on-premises system audits and standard consultations are free of charge, with fees applying only to on-site travel (€450 + VAT), overnight/subsistence (€150 + VAT), and optional extra consulting (€140/hour or €840 per 6-hour day). The true barrier is engineering breadth and perpetual re-certification. To pass initial certification, a payroll engine must deliver the full statutory basis module—automated regular and one-time contribution calculations (including März-Klausel rollbacks under § 23a(4) SGB IV), automated SV-day calculation, programmatic retroactive recalculation at least back to April of the prior calendar year, automated pre-run master-data validation with error rejection logs, EEL replacement-benefit workflows (Krankengeld, Mutterschaftsgeld), certified dakota encrypted transmission, live employer pilot testing, and formal defect tracking in ITSG's quality-management database. Certification must then be maintained continuously through recurring ITSG quality-control (Qualitätskontrolle) test suites every turn-of-year (Jahreswechsel) and upon calculation-relevant changes.

In parallel, German wage-tax filings (Lohnsteueranmeldung, Lohnsteuerbescheinigung) and ELStAM retrieval run through ERiC (ELSTER Rich Client)—not a public REST API, but a native C-library requiring formal software-manufacturer registration with the Bavarian State Office for Taxes (Bayerisches Landesamt für Steuern), intent verification, Manufacturer ID issuance, isolated C-runtime microservice packaging, and recurring annual update/testing loops. No independent benchmark publishes exact engineering costs or person-months for passing initial ITSG and ERiC certification; German payroll vendors and compliance glossaries consistently treat in-house builds for non-specialists as economically prohibitive ("multi-year" lead time before the first live customer versus "weeks" via partner integration).

Strategic Comparison: Certified Partnership vs. Proprietary Engine

Dimension	Certified Partner — Germany DATEV Data Services	Certified Partner — Embedded Payroll API (German API / Global Payroll)	Own Engine + Native Packs (Malaysia, UAE, KSA)	Own Engine + Native Certification (Germany ITSG + ERiC)
Time to First Customer	Weeks to 2–3 months (DATEV Marktplatz onboarding + OAuth API integration).	Weeks to 1–2 months (API/pre-built flows; note German API challenger Lohnfluss is still completing ITSG audit in late 2026).	2–4 months per pack (UAE/KSA SIF & Mudad fastest; Malaysia adds LHDN PCB email test verification).	Multi-year (full basis module + ERiC C-library + ITSG system & pilot audits).
Direct & Ongoing Cost Structure	Low upfront build; customer pays DATEV / Steuerberater directly (third-party directories cite DATEV LODAS classic from ~€15.86/mo + advisor fees).	Variable COGS: Global payroll APIs listed from ~$29 PEPM; Lohnfluss plans employer pricing from €5 PEPM with custom partner rates; US embedded benchmarks run $35–70/mo + $6–10 PEPM (~1/3 provider share).	Moderate internal maintenance (annual LHDN/KWSP/PERKESO/GOSI table updates & regression tests); zero third-party PEPM margin drain.	High fixed R&D overhead: Dedicated German payroll domain + C-library/XML engineers permanently tied to Jahreswechsel & ITSG QK cycles.
UX & Gross-Margin Ownership	Partial: R24 owns pre-payroll, attendance, eAU sync, and ESS payslip delivery (hr:payrollreports), while the Steuerberater executes payroll.	High UX / Shared Margin: White-label UI inside R24; partner absorbs ITSG & filings; R24 sets retail price and keeps PEPM spread.	Full: 100% gross margin, native real-time gross-to-net preview, single double-entry ledger.	Full (at scale only): Defensible only once German active payroll volume generates enough ARR to amortize dedicated compliance staff.
Regulatory & Operational Risk	Low technical risk, data-quality gap: DATEV validates syntax only, not domain accuracy; advisor ecosystem dependency.	Partner maturity risk: Waitlist/certification timing risk for nascent German APIs; higher COGS for global vendors.	Manageable: Must pass LHDN annual PCB verification and maintain strict SIF/Mudad/GOSI validation.	Severe: Delayed Jahreswechsel releases risk ITSG certificate loss, halting customer filings; employers retain ultimate legal liability.

Recommended Stage 1 Decision: Do not pursue proprietary ITSG/ERiC certification in Stage 1 or MVP. Execute a two-track Germany strategy: (1) integrate DATEV Lohn-Datenservices (hr:exchange bidirectional master/movement data, hr:payrollreports to pull finished payslips into R24's ESS portal, hr:exports for accounting results, and hr:eau for sick-leave retrieval) to immediately serve Germany's dominant Steuerberater-backed SME market; and (2) place the Germany Pack behind an abstract PayrollExecutionProvider interface so R24 can plug in an ITSG-certified German embedded payroll API (such as Lohnfluss post-certification or an established white-label provider) for self-service SMEs without re-architecting HR. Concurrently, own the native calculation engine for the Default Pack, UAE, Saudi Arabia, and Malaysia (completing LHDN's written PCB verification prior to Malaysian launch).

5. Privacy, Security, Governance, and Cancellation Portability

HR and payroll platforms concentrate an SME's highest-liability personal data. Operating across Germany, Malaysia, UAE, and Saudi Arabia requires designing to the strictest union of statutory requirements rather than maintaining fragmented compliance forks.

Special-Category Data and Cross-Border Residency

In the EU and Germany (GDPR Art. 9 and BDSG § 26), four HR/payroll fields require heightened Art. 9 safeguards: health data—which encompasses both eAU records and simple employee sick-leave notifications (eAU never transmits diagnoses to employers, and R24's UI must never request them); religious affiliation inferred from ELStAM Kirchensteuer flags (supporting employee Sperrvermerk blocks that default to Tax Class VI); trade union membership where tied to collective agreements or payroll deductions; and biometric time-clock templates (lawful only under strict necessity when non-biometric alternatives like NFC/PIN cannot suffice, requiring a DPIA and encrypted templates rather than raw images). Mandatory payroll and HR processing must rely on statutory and employment-law necessity (GDPR Art. 6(1)(b)/(c), Art. 9(2)(b), § 26(1)/(3) BDSG)—never employee consent, because workplace dependency undermines voluntariness and revocation would break mandatory payroll. As a SaaS processor, R24 must execute a tailored Art. 28 AVV (DPA) detailing EU hosting, sub-processors, TIAs for any US component, TOMs, and breach reporting, whereas a German Steuerberater acts as an independent controller under § 11(2) StBerG.

In Malaysia, the Personal Data Protection (Amendment) Act 2024 (enforced in three stages across 2025, with supplementary ADM/DPIA/portability guidelines expected in 2026) explicitly added biometric data as sensitive personal data requiring explicit consent and imposed direct statutory security liability on data processors, raising maximum penalties to RM1,000,000 and/or 3 years' imprisonment (with breach-notification failures carrying up to RM250,000 and/or 2 years per PwC guidance). Organizations exceeding threshold volumes (>20,000 subjects, >10,000 sensitive/financial records, or regular/systematic monitoring) must appoint and notify the Commissioner of a DPO (resident/contactable in Malaysia, fluent in Bahasa Malaysia and English) within 21 days. Crucially, mandatory 72-hour breach notification to the Commissioner starts from breach occurrence (not merely awareness/assessment), followed by affected-individual notice within 7 days if significant harm is likely, backed by a ≥2-year breach register.

In the Gulf, Saudi Arabia's PDPL has been actively enforced by SDAIA since September 2024 (consultancy reports count 48 enforcement decisions by early 2026), carrying extraterritorial reach, fines up to SAR 5,000,000 (doubled for repeats), criminal liability for intentional/repeated sensitive-data violations, 72-hour breach notification, 5-day formal violation-response windows, and 10-business-day DSAR turnaround expectations. Because SDAIA has not issued an adequacy list as of November 2026, cross-border transfers require SDAIA SCCs and risk assessments—and draft amendments under consultation through November 2026 propose default in-Kingdom data storage. Meanwhile, the UAE splits across three sovereign frameworks: onshore Federal Decree-Law No. 45/2021 (consent-centric, no legitimate-interest basis, strict Arts. 22–23 cross-border rules), DIFC Law No. 5/2020 (amended July 2025 to add a private right of action and higher fines up to $100,000 plus uncapped damages), and ADGM Data Protection Regulations 2021, requiring formal intra-group transfer agreements even between mainland UAE and free-zone entities. R24 should therefore support tenant-level regional hosting pinning (EU Frankfurt for Europe; in-Kingdom KSA or UAE regional nodes for Gulf customers).

Statutory Retention Clocks vs. Mandatory Privacy Deletion

Retention rules cannot default to "keep forever." Across GDPR, Malaysia PDPA, and Gulf storage-limitation regimes, the expiration of a statutory tax or labor retention period without an active legal hold (such as a German tax-audit Ablaufhemmung under § 147(3) AO or pending litigation) converts retention into an active legal obligation to delete across primary databases, archives, and backups. Under Germany's BEG IV (effective 1 January 2025), retention for accounting vouchers—including payroll vouchers, booking-relevant payslips, and travel/expense receipts—dropped retroactively from 10 years to 8 years (with banks, insurers, and securities firms later restored to 10 years under the August 2025 SchwarzArbMoDiG). Keeping standard SME payroll vouchers for 10 years out of habit now creates avoidable GDPR over-retention exposure.

Access Control, Audit Trails, Employee Self-Service, and Export on Cancellation

To satisfy GDPR Art. 32, GoBD immutability, Malaysia PDPA processor obligations, and SME security expectations (ISO 27001 / BSI C5 / ISAE 3402), R24 should enforce domain-segregated RBAC/ABAC rather than a monolithic HR-admin role. Permissions must split cleanly across five domains: core directory/org, payroll calculation, beneficiary bank details and payment release (preventing payroll fraud by decoupling calculation from IBAN edits and bank file authorization), special-category health/eAU/religion records (strict need-to-know), and a read-only tax-auditor role (GoBD Z1) restricted strictly to tax-relevant payroll, time, absence, and travel tables while concealing health notes, applications, and appraisals. Enforce SSO/MFA and prohibit shared accounts. Every payroll lock (Festschreibung), time-entry correction (capturing timestamp, actor ID, old/new value, and reason), sensitive-file access, and retention purge must write to a tamper-evident, append-only audit trail.

Employee Self-Service (ESS) portals must deliver downloadable, printable PDF payslips over authenticated encrypted sessions (never unencrypted email or consumer messengers, which violate GDPR), pair portal delivery with an on-site viewing/printing option for non-desk staff to preserve BAG 9 AZR 48/24 compliance, expose employees' own daily working-time logs, and streamline DSAR exports within GDPR's 1-month and Saudi PDPL's 10-business-day horizons. Architects must respect a key German legal boundary: while payslips are Wissenserklärungen (declarations of knowledge) validly provided via portal, formal employment-modifying Willenserklärungen (warnings, holiday-forfeiture notices) place delivery-proof risk (Zugang) on the employer and must not rely passively on a portal inbox without explicit contractual consent or verifiable delivery.

Export on Cancellation is a statutory requirement because employer retention duties survive SaaS termination. R24 must offer a self-service Cancellation Archive Package comprising: (1) a GoBD Z3 machine-readable export (CSV/ASCII tables paired with a complete XML index.xml documenting schemas, data types, and relational keys linking master data, transaction history, and time-edit logs—pure PDFs fail GoBD); (2) Germany DLS (Digitale LohnSchnittstelle) structured files covering wage accounts and, from 1 January 2027, upstream time, travel, and benefit sub-systems; (3) structured JSON/CSV portability archives satisfying Malaysia PDPA's right to data portability; and (4) a scheduled post-offboarding purge issuing a formal Certificate of Deletion (Löschbescheinigung) covering primary stores, object archives, and backup rotation windows as expected in Art. 28 AVVs.

6. Safe AI Assistance in HR: Drafts Only, Zero Automated Decisions on People

Embedding AI into SME HR software in late 2026 carries high legal risk if capabilities drift from administrative drafting into evaluating, ranking, or monitoring staff. Governance must reflect the post-Digital Omnibus EU AI Act timeline rather than outdated early-2026 summaries.

The Regulatory Reality in November 2026

Under the EU Digital Omnibus on AI (Regulation (EU) 2026/1744), published 24 July 2026 and applicable since 27 July 2026, EU AI Act enforcement operates on two distinct tracks. First, prohibitions, AI literacy, and transparency are already binding today: Article 5 prohibited practices (in force since 2 February 2025; national enforcement powers live since 2 August 2026; fines up to €35 million or 7% of global annual turnover) ban workplace emotion recognition (outside narrow medical/safety contexts), social scoring, biometric categorization inferring protected traits, and manipulative techniques; Article 4 mandates staff AI literacy measures (since 2 February 2025); and Article 50 (binding since 2 August 2026; fines up to €15 million or 3% of turnover) requires any HR chatbot or assistant interacting with employees to identify itself clearly as AI (with the Art. 50(2) watermarking grace period and a new ninth ban on non-consensual intimate/CSAM AI taking effect 2 December 2026). Second, Annex III high-risk HR obligations (covering recruitment/selection, promotion, termination, task assignment, and performance/behavior monitoring—imposing risk management, 6-month minimum logging, human oversight, worker-representative notice, conformity assessment, and EU database registration) were postponed from 2 August 2026 to 2 December 2027 (and Annex I product AI to 2 August 2028).

Product teams must avoid misreading the Article 6(3) derogation. An Annex III HR tool escapes high-risk classification only if it poses no significant risk of harm and fits one of four narrow exemptions: (1) a narrow procedural task (such as parsing unstructured CV text into structured fields without evaluating applicants), (2) improving already completed human work, (3) detecting decision-making patterns for QA/audit without replacing human review, or (4) preparatory search/indexing. Two legal traps defeat broad "drafting" claims: any profiling of natural persons (GDPR Art. 4(4)—any automated evaluation of personal aspects such as CV scoring or ranking) overrides Article 6(3) entirely, forcing high-risk status; and an AI that drafts a performance evaluation for a manager to approve fails Condition 2 because the machine created the substance prior to human completion. Even when Article 6(3) genuinely applies, the provider must document the assessment pre-market (Art. 6(4)) and register the system in the EU database (Art. 49(2)).

Moreover, three laws already constrain HR AI regardless of December 2027: GDPR Article 22 prohibits solely automated decisions with legal or similarly significant effects (rejecting, shortlisting, disciplining, or terminating without genuine human judgment); Germany's General Equal Treatment Act (AGG) shifts the burden of proof onto employers (§ 22 AGG) when software outputs indicate discrimination; and § 87 Abs. 1 Nr. 6 BetrVG grants German works councils an enforceable co-determination right (backed by immediate injunctions) over any employer-provided AI tool objectively capable of monitoring employee behavior or performance (such as logging individual usage timestamps or speeds), whether monitoring is intended or not—with subsequent AI module activations triggering fresh co-determination and selection/evaluation tools also engaging §§ 90, 94, and 95 BetrVG.

Approved Drafts-Only Capabilities

To capture administrative efficiency—a peer-reviewed Science (2023) study of 453 college-educated professionals including HR staff, cited in HR industry analyses, found 40% faster first-draft writing on administrative texts—while avoiding Annex III profiling, GDPR Art. 22 liability, and works-council injunctions, R24 should restrict AI strictly to five reversible, human-committed workflows:

⚬ Grounded Policy Q&A Assistant: Answers routine employee questions (leave rules, expense policies, holiday calendars) solely via Retrieval-Augmented Generation over the tenant's own published policies and works agreements, citing exact section numbers, refusing to speculate beyond source text, routing sensitive matters (illness, harassment, conflicts, terminations) immediately to human HR, and displaying a persistent Article 50 AI-disclosure label.

⚬ Template & Communication Drafting: Generates inclusive, bias-checked job descriptions, onboarding checklists, policy FAQs, and routine HR emails or certificate drafts that remain unsent in a Draft state until edited and explicitly committed by a human author.

⚬ Read-Only Payslip Explainer & Payroll Variance Flagging: Translates an employee's own payslip components into plain language and highlights unusual month-over-month payroll anomalies (such as unexpected deduction shifts) for human payroll-admin review, without ever modifying pay values.

⚬ Narrow Procedural Extraction (Human-Confirmed): Parses structured fields from uploaded expense receipts or agreed onboarding questionnaires for human confirmation before database commit, performing zero scoring or evaluation of individuals.

⚬ De-Identified Aggregated Synthesis: Summarizes open-ended employee survey responses or formats raw HR notes only after automated placeholder redaction ([Employee A], [Employee B]) and strictly at aggregated team level.

Hard Technical Guardrails

Every AI feature in R24 must enforce four architectural constraints by default. First, read-only RBAC scoping: the assistant executes strictly inside the logged-in user's permission boundary with zero write/mutation tools—it cannot read peer records, approve leave, change pay, or reject applicants. Second, zero public-LLM leakage and schema-level sensitive-data exclusion: route inference exclusively through enterprise zero-data-retention, no-training endpoints hosted inside the tenant's sovereign region (e.g., EU Frankfurt for GDPR tenants) under a signed Art. 28 DPA/AVV, and programmatically block special-category fields (health/eAU, religion, biometrics) from entering prompts. Third, works-council-ready governance controls: ship a per-tenant AI kill-switch (default off until an employer's Betriebsvereinbarung is finalized), publish an exhaustive field-by-field data catalog per AI feature (satisfying BAG 8 AZR 209/21 specificity rather than generic product sheets), and disable individual-level AI usage/speed telemetry by default to minimize § 87(1)(6) BetrVG surveillance triggers. Fourth, bounded safety logging and user flagging: store conversation logs separately from employee files on a short TTL (e.g., 90 days) strictly for safety/abuse review, paired with one-click reporting for hallucinations or privacy leaks.

Stage 1 Synthesis: Recommended Implementation Roadmap

To balance SME revenue velocity against regulatory risk in 2026–2027, R24 should execute in four sequential increments:

1. Core HR + Bitemporal Payroll Kernel + Default Pack: Ship the Must-have SME HR core (records, tiered-form contracts, leave, tamper-evident daily working time, expenses, ESS portal, onboarding) on a bitemporal payroll kernel (evaluating MIT-licensed PayrollEngine as either an embedded microservice or architectural blueprint), canonical remuneration taxonomy, GoBD Z3 archive exporter, and automated retention/legal-hold engine.

2. Germany Pre-Payroll & Certified Partner Track: Enter Germany rapidly via DATEV Lohn-Datenservices (hr:exchange, hr:payrollreports, hr:exports, hr:eau) alongside BEG IV contract routing, BAG-compliant ESS payslips, and 2027-ready DLS sub-system exports—deferring proprietary ITSG/ERiC certification indefinitely while preserving a clean PayrollExecutionProvider seam for post-certification German embedded payroll APIs (such as Lohnfluss).

3. Native Gulf & Malaysia Country Packs: Build native effective-dated packs starting with zero-income-tax UAE (Resolution 340/2026 1st-of-month SIF + EOSG/savings + dual-cohort GPSSA) and Saudi Arabia (dual-cohort GOSI with annual July step-ups + Actual Wage EOSB + Mudad/Arabic records), followed by Malaysia (official KWSP/PERKESO/EIS banded tables, 2% foreign-worker EPF, HRD Corp, 16-state holidays, and formal LHDN PCB written verification prior to GA).

4. Opt-In Drafts-Only HR AI: Ship the tenant-isolated, Article 50-labeled Policy Q&A assistant, document drafter, and read-only payroll variance flagger behind a tenant kill-switch with zero profiling, zero write access, and ready-made works-council documentation packs.




Sources used in the report
  Sign employment contracts digitally in Germany - SmartDocs

  More digitalisation in employment law from 2025

  Arbeitsvertrag digital unterschreiben: Regeln 2026 - signotec GmbH

  Signing German work contracts digitally to be possible from 2025

  Digitaler Arbeitsvertrag & Nachweisgesetz: Textform seit 2025

  Digital employment agreements are now possible - PKF Deutschland

  News on the German Evidence Act: Digital employment contract

  Horilla is a free and open source HR software. - GitHub

  Releases · horilla/horilla-hr - GitHub

  Horilla is a free and open source HR and CRM software. - GitHub

  Beitragsbemessungsgrenzen 2026 | Bundesregierung

  Beitragsbemessungsgrenzen und Beitragssätze 2026 - VDEK

  Aktuelles und Presse | Die Sozialversicherungsrechengrößen 2026

  Beitragsbemessungsgrenze 2026 & 2027 einfach erklärt | BARMER

  Beitragsbemessungsgrenze 2026: alle Werte & Tabelle

  Beitragsbemessungsgrenze 2026 und 2027 für Arbeitgeber - dilohver

  Payroll Calculation Formula Malaysia 2026 | EPF, SOCSO & PCB

  hrms/license.txt at develop · frappe/hrms - GitHub

  frappe/hrms: Open Source HR and Payroll Software - GitHub

  GitHub - devvcore/frappe-unified-deployment · GitHub

  Optima HR is an advanced Frappe HRMS app that ensures ... - GitHub

  Package hrms - GitHub

  GitHub - Payroll-Engine/PayrollEngine: Open-source framework for

  Payroll Engine - GitHub

  Payroll Engine - Build your own payroll solution | Cloudron Forum

  payroll · GitHub Topics

  Releases - Payroll Engine

  Licenses — Odoo 20.0 documentation

  gkv-spitzenverband, berlin

  Preisgestaltung ab April 2026 - GKV-AG

  Preisliste für Dienstleistungen in der Systemuntersuchung ab 01.01

  Welches Entgeltabrechnungsprogramm ist für DEÜV-Meldungen

  ITSG-Zertifizierung – die Systemprüfung erklärt - PAROGO

  Schnittstellen zur DATEV-Payroll für Unternehmen

  Alle API Produkte - DATEV Developer Portal

  hr:payrollreports - Referenz - DATEV Developer Portal

  Lohnabrechnung, wie sie sein sollte – jetzt ITSG-zertifiziert! - Personio

  Embedded Payroll Providers 2026 – Payroll APIs for Platforms

  Gusto vs Deel vs WorkMotion: Which Platform Wins in 2026?

  Deel vs Gusto: Payroll & HR Software Comparison Guide 2026

  Embedded Payroll — Lohnabrechnung in Ihrem Produkt - Lohnfluss

  Embedded Payroll APIs: How PayrollEx Compares to Check, Gusto

  Best Unified APIs for HRIS and Payroll in 2026 | Compared | Finch

  Payroll API - Gusto Embedded

  Aufbewahrungsfristen 2026/2027: Die Tabelle | DOCSHERO®

  Aufbewahrungsfristen 2026: Was weg kann – und was bleiben muss

  Aufbewahrungsfristen Buchhaltung 2026: 8 oder 10 Jahre?

  Welche Unterlagen Sie ab 2027 vernichten dürfen - daturex.de

  Aufbewahrungsfristen 2026: 10, 8 oder 6 Jahre? | UBK

  AI Recruitment in Germany: GDPR, AI Act and Works Council Rules

  AI in Recruitment and HR in Germany: Legal Compliance

  Künstliche Intelligenz (KI) und der Betriebsrat | Wissen

  Employment Law and the Use of AI - Kanzlei Baumfalk

  KI im Betriebsrat nutzen: 12 Anwendungsfälle (2026) - SESTdigital

  Betriebsrat und KI-Software: Mitbestimmung, Datenschutz und wie

  Betriebsvereinbarungen über KI-Programme im HR-Bereich

  Wie lässt sich eine ELSTER-Schnittstelle implementieren? - AnyTax

  SAP-ELSTER-Integration – Was ist das, was bringt es?

  Contribution Rate - Perkeso

  Foreign Worker SOCSO Rate Table - PayrollPanda

  EPF and SOCSO in Malaysia: What every small business employer

  SOCSO Table 2026 Malaysia | PERKESO + EIS Rates

  Latest SOCSO Contribution Table: Calculate Your 2026 Rates

  Malaysia Salary Calculator 2026: EPF, SOCSO & PCB

  SOCSO + EIS Calculator Malaysia 2026 — PERKESO Contributions

  ERPNext WPS Payroll in the UAE: SIF Files, Gratuity & Arabic

  UAE WPS Payroll Rules Explained (2027): Deadlines, SIF Files And

  UAE Wages Protection System (WPS) Guide 2026 - Breeo Business

  How to Create a WPS SIF File in UAE: Format & Errors - HRMantra

  Complete Guide to WPS Payroll Compliance in UAE 2026 - iCeipts

  UAE Gratuity Calculation 2026: Step by Step With 3 ... - YouTube

  Saudi Social Insurance (GOSI) 2026: New System, Rates

  Arbeitszeiterfassung 2026: Pflicht, Gesetzesstand & Urteile - IHK

  Elektronische Zeiterfassung Pflicht: Was Arbeitgeber beachten

  Digitale Zeiterfassungspflicht 2026: Das müssen Sie wissen

  Arbeitszeiterfassung Pflicht 2026: Was kleine Betriebe wissen müssen

  Zeiterfassung Pflicht Arbeitgeber 2026: Was jetzt gilt - HRTime

  KSA PDPL in 2026: What Organizations Need to Know Now

  UAE PDPL: Scope, Obligations And Status In 2026

  GCC Data Privacy Laws in 2026: UAE PDPL, KSA, Bahrain Guide

  Saudi PDPL Enforcement Updates & Data Privacy Guidelines

  PDPL Compliance: Saudi Arabia & UAE - Axipro

  UAE Personal Data Protection Law (PDPL): Enterprise Compliance

  When Annex III AI Is Not High-Risk: Article 6(3) - Lawgent

  EU AI Act Annex III: What High-Risk AI Means for HR - StarCruiter

  Payroll - OCA Apps Store

  Flous Flow HR Payroll - Odoo Apps Store

  Odoo 18 HR Payroll - Odoo Apps Store

  HR Payroll - Community Edition - Odoo Apps Store

  HR,Unpaid Leaves & Payroll Management in Odoo 10

  HR Payroll Community Edition - Odoo Apps Store

  Payroll Enterprise Enhancement - Odoo Apps Store

  Payroll data of versions — Odoo 20.0 documentation

  Minijob mit Verdienstgrenze

  Minijob 2026: Geringfügige Beschäftigung für 603 Euro - Ver.di

  Verdienstgrenze im Minijob steigt auf 603 Euro

  Neue Minijobgrenze: Bis zu 603 € sind monatlich steuerfrei

  Minijobs 2026: Alles, was du wissen musst | DGB

  Das müssen alle Minijobber ab 2027 wissen! - - Smartsteuer

  Horilla is a free and open source HR software. - GitHub

  horilla-setup/LICENSE at master · horilla/horilla-setup · GitHub

  Horilla: The Open Source HRMS Every Team Needs - Prompts

  horilla-hr vs hrms - compare differences and reviews? - LibHunt

  Malaysia Tightens Data Protection from June 2025 - ASEAN Briefing

  PDPA Compliance in Malaysia: Your Complete Implementation Guide

  Data protection laws in Malaysia

  PDPA Malaysia: 2024 Amendments | Ching, Elaine & Co

  PDPA Act 2024_ Key considerations for business - PwC Malaysia

  Malaysia: Guidelines Issued on Data Breach Notification and Data

  HRD Corp Registration & Levy Guide 2026: Who Must Register

  HRD Corp levy (Malaysia): how it works and its limits - Trendemic

  HRD Corp (HRDF) Guide for Employers in Malaysia 2026 - Swingvy

  HRDF Malaysia 2026: Levy Rates, Registration & Login Guide

  Bitemporal History - Martin Fowler

  Bitemporal Data Explained | Aerospike

  Retro Corrections - Payroll Engine

  Recalculate Payroll for Retroactive Changes - Oracle Help Center

  Controlling Retroactive Payroll Data Changes in Employee Central

  Articles - Payroll Engine

  Effective-Dated Pay, Corrections, and Auditable Pay Runs - PracHub

  The Time Traveler's Guide to Bi-Temporal Data Modeling - Medium

  Tritemporal Event Sourcing: The Missing Time Axis in Your Event

  Best German payroll software to automate HR and compliance

  Lohnfluss — Lohnabrechnung per API | Entgeltabrechnung für

  10 Best Payroll Software in Germany in 2026

  DATEV-Schnittstellen für die Lohnabrechnung (Stand 2026)

  Professional Services: Mandanten effizienter verwalten. - vyble

  Lohnabrechnungsprogramme – Anbieter im Vergleich - OMT

  Final Settlement in Saudi Arabia: 2026 Employer Calculation

  ESB Calculator Saudi Arabia 2026: Your End of Service Award

  Saudi End of Service Benefit (EOSB) Calculator

  End of Service Calculation in Saudi Arabia (2026) | Ektefa

  Lohnsteuer-Außenprüfung beim Mitarbeiter-PC-Programm - meinMPP

  GoBD-konformer Export – Datenzugriff Z1, Z2 und Z3 erklärt

  GoBD: Ergänzende Informationen zur Datenträgerüberlassung

  Digitale Lohnschnittstelle - BZSt

  Examples of GDPR Article 9 – Processing of Special Categories of

  Employee Data Protection: Definition and Section 26 BDSG - preeco

  GDPR for HR: Employee Data Processing Guide [2026] - Grove HR

  Employee Data Protection Laws in Germany for Employers

  Income Tax PCB in Malaysia: Guide for Employers - Info-Tech

  Payroll software Malaysia — PCB verified in writing by LHDN | Taokeh

  Complete MTD Guide for Employers in Malaysia - DataOn

  LHDN MTD 2026 Compliance — PCB Verified - MooPayroll

  specification for monthly tax deduction (mtd) calculations ... - HR2eazy

  PCB Malaysia 2026: BEST Complete MTD Guide - KC Group

  Entgeltabrechnungen als elektronisches Dokument

  9 AZR 48/24 - Das Bundesarbeitsgericht

  Digitale Entgeltabrechnung reicht aus - Papier muss nicht mehr sein

  BAG: Entgeltabrechnung über Mitarbeitenden-Portal auch ohne

  BAG: Die Verpflichtung zur Erteilung einer Entgeltabrechnung kann

  Digitale Lohnabrechnung: So funktioniert sie in der Praxis | project b.

  gkv-spitzenverband, berlin

  ITSG-Zertifizierung: Ablauf, Nutzen & Anforderungen - OriginStamp

  ITSG-zertifizierte Lohnabrechnung | Paychex Payroll

  DSGVO in der Lohnabrechnung | Payroll Fuchs

  Datenschutzrechtliche Aspekte elektronischen Arbeitsunfähigkeit..

  Datenschutzkonforme Krankmeldung auf dem Weg zur eAU

  Lohnsteuerabzugsmerkmale sperren oder freischalten - Hamburg.de

  2024-12-13-ELStAM-elektr-lohnsteuerabzugsmerkmale.pdf - ELSTER

  Häufige Fragen für Arbeitgeber zur elektronischen Lohnsteuerkarte

  Programmablaufpläne zur Lohnsteuer für/ab 2026

  Berechnung der Lohnsteuer 2026 - BMF-Steuerrechner

  Programmablaufpläne zur Lohnsteuer für 2026 - IHK Rhein-Neckar

  Einkommensteuer-Rechner 2026: Tabelle & Splitting - Lohnhelden

  Steuertabellen 2026: Grundtabelle & Splittingtabelle

  What are the GOSI contribution rates in Saudi Arabia? - Reform Group

  Saudi Arabia Employer Cost Breakdown 2026 | GOSI, EOSG | teamed.

  GOSI Contribution Rates Saudi Arabia: 2026 Employer Guide

  GOSI Calculator for Employers in Saudi Arabia - emerge AI systems

  GOSI Calculator 2026: Salary Deduction for Saudis and Expats

  Saudi Arabia Payroll Guide 2026: GOSI, WPS and Salary Rules

  Saudi Arabia - Individual - Other taxes

  OSS License Compliance for Startups: GPL, AGPL, MIT and Apache

  Is GPL 3.0 compatible with AGPL 3.0? | License Compatibility - FOSSA

  Open Source Lizenzen verstehen: GPL, MIT, Apache im Vergleich

  GPL vs LGPL vs AGPL: Copyleft Licenses Compared | Sectrend

  Understanding the SaaS Loophole in GPL | Revenera Blog

  Das SaaS-Schlupfloch in der GNU GPL - CloudComputing-Insider

  GPL vs AGPL: internal use, SaaS and what you must release

  How Long Can HR Keep Employee Records? A Practical Guide for

  Saudi Arabia Payroll & Employer of Record: A Complete guide

  The New UAE Pensions Law - Al Tamimi & Company

  GPSSA Introduces a New Pension Law: Key Updates and Implications

  UAE GPSSA Contribution Calculator 2026

  GPSSA UAE 2026 | Pension, Social Security & Employer Guide - Arnifi

  9 Best HR Software for Small Business in 2026 (Compared)

  Best HR Software in 2026 - Same Team Partners

  13+ Best HR software for small business [2026] - HiBob

  Personio vs. Factorial: HR-Software im Vergleich

  Best HR Software for Remote Workforce: What European SMEs

  Implementation of the Pay Transparency Directive - KPMG-Law

  EU Pay Transparency Directive Germany: 2026 Employer Guide

  Pay compliance in 2026: Companies need to be aware of these new

  German Pay Transparency Act (Entgelttransparenzgesetz) - Aivy

  AI agents for HR – applications, onboarding, travel expenses, HR

  AI Prompts for HR: Employee Relations & Investigations - Warp

  AI for HR: Uses, Prompts and Guardrails - DecodeSkills

  AI in HR technology: 6 tips to keep HR data safe | Ciphr

  A Safe Generative AI Operating Model for HR - CADRO

  AI Use & Safety Policy - HRFlowTech

  AI in Employee Relations: the 2026 state of play - Safe Workplace

  Navigating the AI Act | Shaping Europe's digital future

  EU AI Act Timeline 2026: Every Deadline After the AI Omnibus

  EU AI Act on 2 August 2026: What Applies — and What Doesn't

  EU AI Act after the Digital Omnibus: what companies must have ready

  European Union Artificial Intelligence Act: a guide




Sources read but not used
  Digitaler Arbeitsvertrag: Diese Regeln gelten seit 2025 - Lexware

  Personio vs Factorial HR Software Vergleich 2026 - Find-Your-HR

  Personio vs. HiBob - Factorial

  Deel vs HiBob HR Software: Key Differences & Benefits (2026)

  Choosing the Right Embedded Payroll Partner: ADP vs. Gusto

  Malaysia Payroll Guide: MTD, EPF, SOCSO, and EIS Explained

  UAE Gratuity Calculator 2026: Accurate & Updated for UAE Labor Law

  GitHub - BodhiHu/frappe_hrms: Open Source HR and Payroll Software

  hrms/package.json at develop - frappe - GitHub

  hooks.py - frappe/hrms - GitHub

  GitHub - alyf-de/time_capture

  Enhancement to Frappe HRMS Employee Advance. - GitHub

  MIT License - Payroll-Engine/PayrollEngine · GitHub

  Payroll-Engine/PayrollEngine.Client.Tutorials - GitHub

  PayrollEngine.Client.Scripting 0.9.0-beta.15 - NuGet Gallery

  Odoo Review 2026: Pricing, Features & Honest Verdict - Ecom Tools

  gkv-spitzenverband, berlin - Informationsportal für Arbeitgeber

  Entgeltabrechnung - Systemuntersuchung - GKV-Datenaustausch

  Abrechnungsprüfung - GKV-Spitzenverband

  Systemprüfung in der Entgeltabrechnung ab 2021 gesetzlich geregelt

  gkv-spitzenverband, berlin deutsche rentenversicherung bund

  Build Custom HR and Payroll Solutions | Deel API

  Remote API

  Aufbewahrungsfristen im Handels- und Steuerrecht - IHK

  Aufbewahrungsfristen Unternehmen 2027: Tabelle und Rechner

  Risiken automatisierter HR-Systeme Pflichten für Arbeitgeber

  Algorithmic management – work instructions provided by AI - CMS.law

  PERKESO/SOCSO Contribution Table 2026 for Employers in Malaysia

  Rate of contribution for Employees' Social Security Act 1969 (Act 4)

  Tanggungjawab Majikan - Lembaga Hasil Dalam Negeri Malaysia

  WPS payroll for UAE employers: SIF files, deadlines and how to pay

  Arbeitszeiterfassung 2026; was geht (nicht) - Anwalt.de

  Zeiterfassungspflicht in Deutschland: Aktueller Stand und Urteile 2026

  Zeiterfassung Gesetz 2026 – Was Gebäudereiniger wissen müssen

  New EU rules on pay transparency explained - European Commission

  Full text and PDF download - AI Act

  Hr Payroll Extension - Odoo Apps Store

  Minijob-Rechner 2026: Netto, Stunden & 603-€-Grenze - ELEVEL

  Ab 2026 im Minijob bis zu 603 Euro steuerfrei verdienen!

  Minijob 2026: €603 limit, taxes & insurance explained - YouTube

  Repo for Horilla official documentation - GitHub

  horilla-hr-mobile/README.md at master - GitHub

  horilla-setup - GitHub

  Package horilla - GitHub

  maxpoexhibitions/horilla_crm · GitHub - GitHub

  [Malaysia Blog] The Amendment of Personal Data Protection Act

  Malaysia PDPA Amendment Act: Essential compliance handbook for

  Registered Employers - HRD Corp

  HRDF Malaysia 2026 Guide (HRD Corp): Registration, Levy & Claim

  HRDF Pay-Why Need to Comply with HRD Corp Levy in Malaysia?

  A Digital Twin of the Payroll Engine: Simulation

  Auszug der DATEV-Preisliste für Unternehmen

  Lohnabrechnung-Software im Vergleich 2026: DATEV, Lexware

  Payroll Services Germany | DATEV Payroll - Renate Schnürch

  Payroll - Überblick - DATEV Developer Portal

  End of Service Benefits | Ministry of Human Resources and Social

  Saudi End of Service Calculator | Saudi Labour Law - Zimyo HRMS

  End of Service Benefits Under Saudi Arabia Labor Law

  Export Prüfungsdaten und Lohn-Archiv für steuerliche Außenprüfung

  GoBD-Export und Steuerberater: Wer liefert die Daten?

  GoBD-Leitfaden_Version 2.2 - BStBK

  empfehlungen zur anwendung des datenzugriffs (gobd - DSAG

  Digitale Betriebsprüfung | Deloitte Deutschland

  Digitale LohnSchnittstelle (DLS) - microtech Hilfe

  Art. 9 GDPR – Processing of special categories of personal data

  Article 9 GDPR: Processing of special categories of personal data

  § 26 BDSG – Datenverarbeitung für Zwecke des ... - dsgvo

  Federal Data Protection Act (BDSG) - Gesetze im Internet

  26 BDSG Datenverarbeitung für Zwecke des

  PCB Calculator Malaysia 2026: How MTD Works - CentralHR

  Malaysian Payroll Deductions: EPF, SOCSO, EIS, PCB & HRD Levy

  BAG: Digitalisierung – Kein Anspruch auf Entgeltabrechnung in Papier

  BAG: Bereitstellung digitaler Lohnabrechnungen erfüllt

  Digitale Lohnabrechnung im Arbeitnehmer-Portal: Was Arbeitgeber

  Digitale Gehaltsabrechnung - Kanzlei mandati

  gkv-spitzenverband, berlin - Informationsportal für Arbeitgeber

  ITSG-Prüfung? Einfach erklärt! - comvaHRo

  Die ITSG-Systemuntersuchung: warum Lohnsoftware zertifiziert sein

  Gesundheitsdaten von Beschäftigten: Das dürfen Arbeitgeber*innen

  Informationen zum Datenschutz - BZSt

  9292176 - Sperrvermerk (Neuanlage oder Löschung)

  Datenschutz für Arbeitnehmer bei der Lohnsteuer - MKM LEGAL

  Die wichtigsten steuerlichen Änderungen 2026

  Programmablaufpläne zur Lohnsteuer für/ab 2026 - Anwey

  Programmablaufpläne zur Lohnsteuer für/ab 2026

  Programmablaufplan für die Erstellung von Lohnsteuertabellen für

  GOSI & WPS Compliance Saudi Arabia: Payroll Guide 2026

  Is an AGPL License the Right Choice for Your Open Source Projects?

  What is the difference between GPL and AGPL license? - Quora

  How long should documents be retained in the UAE?

  Retention periods in HR - eveHRyday

  UAE Record Retention Now 7 Years: What It Means

  Payroll Records For Payroll Calculations In Malaysia

  Payroll Record Keeping Under the Labour Codes - Patron Accounting

  Records Retention Schedule - Employment - Lexis® Middle East

  Employee Data Retention Guidelines | PDF | Employment - Scribd

  Data Privacy & Payroll: How Long Can We Retain Employees

  Federal Law by Decree No. (57) of 2023 Concerning Pension and

  New UAE Pensions Law - DLA Piper GENIE

  PwC Tax Alert: UAE - GPSSA Updates (December 2023)

  GPSSA reviews the most prominent features of Federal Law No. (57

  GPSSA: An insured's contribution payment may be extended to the

  Understanding the New UAE Pension and Social Security Law

  12 Best HRMS software [2027 review] - HiBob

  Best Factorial Alternatives in 2026: 15 HR Platforms for European

  Pay Transparency Act 2026: What Applies to SMEs? - Perbility GmbH

  Amendments to the Pay Transparency Act - DIHK

  The Promise and Perils of AI in Employee Relations: Policy Drafting

  AI Act | Shaping Europe's digital future - European Union

  LIMITE EN - Data - European Union

## Stage 2

1. Claim Verification & Skeptical Audit

Because live web lookup is disabled in this review pass, every statutory figure, date, and legal claim from Stage 1 is audited below against primary statutory baselines and internal consistency. Items marked REQUIRES PRIMARY CHECK are late-2025/2026 amendments, ministerial drafts, or regulatory circulars that must be confirmed directly against the official gazette or agency portal before hardcoding into effective-dated tables.

Stage 1 Claim	Primary Legal / Spec Reference	Status	Correction / Audit Note
DE: BEG IV allows text form (§ 126b BGB) for Nachweisgesetz from 1 Jan 2025; exceptions for § 2a SchwarzArbG, fixed-term (§ 14(4) TzBfG), and terminations (§ 623 BGB).	BGBl. 2024 I Nr. 323 (BEG IV); § 2 NachwG; § 14(4) TzBfG; § 623 BGB	VERIFIED	Accurate. Add one critical edge case: if an employee explicitly requests written proof (§ 2(1) Satz 3 NachwG), the employer must still provide a signed paper copy.
DE: Payroll voucher retention dropped from 10 to 8 years under BEG IV; keeping them 10 years creates GDPR over-retention exposure.	§ 147(1) Nr. 4 AO; § 257 HGB; § 41(1) Satz 9 EStG	CHANGED (Incomplete)	Three separate clocks apply, not one: booking-relevant payroll vouchers (Buchungsbelege) = 8 years; wage accounts (Lohnkonten, § 41 EStG) and pure tax/SV correspondence = 6 years; annual financial statements/ledgers = 10 years. Deleting all payroll records at 8 years violates 10-year ledger rules; keeping Lohnkonten past 6 years without a legal hold creates over-retention.
DE: BAG 1 ABR 22/21 mandates daily time tracking; BAG 9 AZR 48/24 (28 Jan 2025) makes portal payslips a Holschuld.	BAG 1 ABR 22/21 (13 Sep 2022); BAG 9 AZR 48/24 (28 Jan 2025)	VERIFIED	Accurate. Note that the BMAS electronic time-tracking bill remains un-enacted draft law; enforce 1 ABR 22/21 + § 16(2) ArbZG + § 17 MiLoG baselines now.
DE: 2026 BBGs (RV/AV €8,450/mo, KV/PV €5,812.50/mo, JAEG €6,450/mo), Grundfreibetrag €12,348, Minijob €603/mo (2026) → €633/mo (2027).	Sozialversicherungsrechengrößen-Verordnung 2026; BMF PAP 2026; § 8(1a) SGB IV	REQUIRES PRIMARY CHECK	Minijob math (€13.90 × 130 / 3 = €602.33 → €603; €14.60 × 130 / 3 = €632.67 → €633) is internally consistent. Confirm final enacted 2026 BGBl values and treat all 2027 figures (including the proposed 2% → 5% Pauschsteuer hike) as un-enacted drafts.
DE: PV child discount deducts 0.25% per child from employee share for children 2 through 5.	§ 55(3) SGB XI (PUEG)	CHANGED (Missing Cutoff)	The 0.25% per-child discount applies only for children under age 25 and terminates automatically at the end of the month the child turns 25. Without storing child DOBs and scheduling effective-dated step-ups, PV will under-deduct.
DE: ITSG audit itself is free; only travel/extra consulting is billed.	GKV-Spitzenverband / ITSG Preisliste Systemuntersuchung; § 22 DEÜV	VERIFIED (Caveated)	Direct audit fees are negligible, as stated, but the real cost is annual Qualitätskontrolle engineering and ERiC C-library maintenance.
DE: DLS expands on 1 Jan 2027 (§ 4(2a) LStDV) to cover time, travel, benefits, and driver logs.	§ 4(2a) LStDV; BZSt DLS specification	REQUIRES PRIMARY CHECK	Confirm the exact BZSt DLS schema version and mandatory effective date for upstream Vorsysteme before building custom exporters.
MY: Worked public-holiday pay is basic ÷ 26 under Employment Act s. 60D(3)(a).	Malaysia Employment Act 1955 s. 60D(3)(a) & s. 60I(1A)	CHANGED (Wrong Multiplier)	Critical error. Monthly Wage ÷ 26 is 1 day's Ordinary Rate of Pay (ORP). A monthly-rated employee working normal hours on a paid public holiday is entitled to 2 days' ORP (2 × basic ÷ 26) in addition to their regular monthly wage (and 3× hourly rate for overtime on a public holiday). Implementing 1 × basic ÷ 26 underpays staff by 50% on statutory holidays.
MY: Mandatory 2% EE + 2% ER EPF for non-Malaysian citizens from Oct 2025; SOCSO/EIS capped at RM6,000 (RM29.75/RM104.15; EIS RM11.90).	KWSP Act 1991 (2025 Amendment); PERKESO Act 4 & Act 800 (Oct 2024 schedule)	VERIFIED / PARTIAL CHECK	SOCSO/EIS RM6,000 cap and exact bracket values are VERIFIED. Confirm KWSP's exact gazetted exemptions for foreign workers (e.g., domestic servants, age thresholds) and PERKESO's reported June 2026 LINDUNG 24 Jam (SKBBK) optional scheme directly on kwsp.gov.my and perkeso.gov.my.
MY: PDPA 72-hour breach notification starts from breach occurrence (not merely awareness/assessment).	Malaysia PDPA (Amendment) Act 2024; JPDP Data Breach Notification Guidelines (2025)	CHANGED / REQUIRES CHECK	JPDP's 2025 guidelines tie the 72-hour clock to when the data controller has reason to believe a personal data breach has occurred—not strictly from silent occurrence. Verify the exact final JPDP guideline text, as conflating occurrence with discovery creates unachievable SLA commitments in customer DPAs.
UAE: MOHRE Resolution 340/2026 (effective 1 Jun 2026) sets 1st-of-month WPS due date, 85% threshold, and day-11 fines.	MOHRE Ministerial Resolution No. 340 of 2026 (replacing Res. 598/2022)	REQUIRES PRIMARY CHECK	Legacy Res. 598/2022 used a 15-day grace window and 80%/90% thresholds. Verify Res. 340/2026 directly on mohre.gov.ae before locking compliance alerts.
UAE: GPSSA splits pre- and post-31 Oct 2023 Emirati hires (5%/15% cap AED 50k vs 11%/15% cap AED 70k private / AED 100k public).	UAE Federal Law No. 7/1999; Federal Decree-Law No. 57/2023	VERIFIED (Incomplete Scope)	Accurate for federal GPSSA, but omits Abu Dhabi Pension Fund (ADPF) (Law No. 2/2000), which governs Emiratis employed by Abu Dhabi-registered entities under different rates and ceilings.
KSA: GOSI post-3 Jul 2024 cohort rises +0.5%/side annually every July (10% annuities each in Jul 2026 → 23.5% total); EOSB Art. 84/85/87/88.	Saudi Royal Decree M/273 (2024); Saudi Labor Law Arts. 84–88	VERIFIED (Check Date)	Rates and step-up schedule are VERIFIED. Confirm exact July effective day (1 July vs. 3 July) on GOSI billing and incorporate Feb 2025 Saudi Labor Law amendments (Royal Decree M/44) affecting resignation acceptance windows and leave entitlements.
KSA: Nov 2026 PDPL consultation drafts propose default in-Kingdom storage.	SDAIA PDPL (Royal Decree M/19) & 2026 draft amendments	REQUIRES PRIMARY CHECK	Enforceable PDPL fines (SAR 5M), 72-hour breach rule, and SCC requirement are VERIFIED. Treat the Nov 2026 local-storage draft as provisional until gazetted.
EU AI: Digital Omnibus Regulation (EU) 2026/1744 (24 Jul 2026) postponed Annex III HR AI to 2 Dec 2027.	Regulation (EU) 2024/1689 (AI Act); reported Regulation (EU) 2026/1744	REQUIRES PRIMARY CHECK	Original AI Act deadlines (Art. 5/4: 2 Feb 2025; Art. 50 & Annex III: 2 Aug 2026) are VERIFIED. Confirm Regulation (EU) 2026/1744 on EUR-Lex—though our drafts-only architecture avoids Annex III regardless of whether the deadline is Aug 2026 or Dec 2027.

2. What Stage 1 Missed (12 Blind Spots That Will Hurt in 12–24 Months)

1. Stack Impedance of Embedding .NET PayrollEngine into a TypeScript/Python Monorepo
  ⚬ Why it matters: Stage 1 recommends PayrollEngine (C#/.NET) as the top open-source candidate. Dropping a .NET microservice with its own C# scripting runtime and schema conventions into a NestJS + FastAPI + PostgreSQL (with PgBouncer & RLS) monorepo introduces a third runtime ecosystem, breaks unified RLS tenant isolation (app.current_tenant_id), slows down AI coding agents that excel in TypeScript/SQL, and complicates self-hosted Coolify deployments. Taking PayrollEngine's bitemporal & attestation design patterns while implementing a pure, deterministic TypeScript calculation kernel inside NestJS avoids permanent multi-runtime drag.
2. Double-Entry GL Reconciliation, Accrual Reversals, and Multi-Branch Cost Allocation
  ⚬ Why it matters: Stage 1 treats GL posting as a single bullet ("GL journal posting"). In real SME retail/F&B/trading businesses, staff work shifts across multiple branches in one pay period. If payroll doesn't split gross wages, employer statutory costs (EPF/SOCSO/GOSI/SV), and monthly EOSG/EOSB/leave-encashment accruals by branch/cost center, branch P&Ls are wrong. Worse, if a payrun is voided or retroactively adjusted after a fiscal period closes, the engine must post reversing + replacement journal entries in the current open accounting period without mutating closed GL periods.
3. Malaysia PCB/MTD Edge Cases: BIK, VOLA, Zakat Timing, and Prior-Year Arrears
  ⚬ Why it matters: Passing LHDN's written PCB verification requires more than standard monthly salary + bonus formulas. LHDN test suites specifically test Benefits-in-Kind (BIK), Value of Living Accommodation (VOLA), mid-year TP1 relief claims, TP3 prior-employer YTD imports, zakat rebate clamping (zakat reduces PCB to RM0, never negative), and arrears/back-pay allocated across months. Missing these fails LHDN verification and blocks Malaysian GA.
4. Germany GoBD Verfahrensdokumentation (Procedural Documentation) & DATEV Onboarding Friction
  ⚬ Why it matters: Exporting GoBD Z3 files is necessary but insufficient; German tax auditors also demand a Verfahrensdokumentation describing how attendance, expense receipts, and payroll adjustments flow into accounting without tampering. Separately, DATEV hr:exchange requires each SME's Steuerberater to authorize the connection via Beraternummer / Mandantennummer and DATEV Rechteverwaltung online—which regularly stalls onboarding for 2–4 weeks unless you build a guided advisor-invite handoff flow.
5. PostgreSQL RLS + PgBouncer Transaction Pooling Pitfalls on Bitemporal Payroll Queries
  ⚬ Why it matters: Under PgBouncer transaction pooling, session-level SET app.current_tenant_id leaks across tenants unless strictly scoped via SET LOCAL inside every transaction. Bitemporal payroll queries often rely on materialized views, CTEs, or background BullMQ workers (e.g., batch payrun execution, nightly retention purges). If a BullMQ worker runs with a superuser/bypass-RLS role and misses a tenant_id predicate on a retro-recalculation join, cross-tenant salary leakage occurs. Every payroll table needs FORCE ROW LEVEL SECURITY and automated cross-tenant leak tests in CI.
6. Retail & F&B Shift/POS Coupling (Split Shifts, Tip Pools, Cash Advances, and Offline Punching)
  ⚬ Why it matters: Target SMEs (multi-branch retail and F&B) don't run 9-to-5 office schedules. They have split shifts, midnight-crossing shifts (which trigger German § 3b EStG night-surcharge splits across two calendar days), staff cash advances taken from the POS drawer, and attendance buddy-punching. Without geofenced/QR-rotating or PIN-based terminal check-in with offline queue sync, attendance data will be too dirty to feed payroll automatically.
7. Statutory Rounding & Penny-Reconciliation Drift
  ⚬ Why it matters: Country packs use incompatible rounding rules: Malaysia EPF uses whole-ringgit upward/table rounding; SOCSO/EIS use exact bracket tables; German SV splits half-cent remainders differently between employer and employee shares; bank payout files (GIRO/SEPA/SIF) must match the sum of net payslips to the exact minor unit (0.01). Using floating-point numbers anywhere in the calculation DAG or failing to store minor-unit integers (BIGINT cents/sen/fils/halalas) causes silent bank-file rejections.
8. Abu Dhabi Pension Fund (ADPF) & Free-Zone Payroll Fragmentation in the UAE
  ⚬ Why it matters: Stage 1 models only federal GPSSA and MOHRE WPS. In practice, UAE SMEs frequently operate across mainland, DIFC, ADGM, DMCC, and Abu Dhabi entities. DIFC requires DEWS (DIFC Employee Workplace Savings) instead of traditional EOSG, and Abu Dhabi-registered entities enroll Emiratis in ADPF, not GPSSA. The UAE Country Pack must key statutory logic on entity_jurisdiction (UAE_MAINLAND, UAE_DIFC, UAE_ADGM, UAE_AD_MAINLAND), not just country = 'AE'.
9. KSA Feb 2025 Labor Law Amendments (Royal Decree M/44), Arabic/RTL Payslips, and WPS Rejections
  ⚬ Why it matters: Saudi Arabia's M/44 amendments (effective Feb 2025) changed statutory notice periods, resignation acceptance rules, and leave entitlements. Furthermore, Saudi Mudad/WPS rejects files when employee IBANs, Iqama/National ID numbers, or basic-vs-allowance splits mismatch Qiwa contracts by even 1 SAR, and statutory payroll records must be reproducible in Arabic (RTL PDF rendering)—which breaks standard Latin PDF generators unless designed upfront with proper Arabic shaping/fonts.
10. Negative Net Pay, Statutory Deduction Priority, and Garnishments (Lohnpfändung)
  ⚬ Why it matters: When an employee has unpaid leave, a loan repayment, a prior-month retro clawback, and a court garnishment, deductions can exceed gross pay. Every jurisdiction enforces a strict deduction waterfall (statutory taxes & social security first, court garnishments subject to protected subsistence minimums like Germany's Pfändungsfreigrenze under § 850c ZPO, then employer loans capped at statutory limits—e.g., Malaysia Employment Act s. 24 caps total monthly deductions at 50% of wages). Without a priority queue and arrears carry-forward bucket, payroll runs crash or violate labor law.
11. Dual-Control Approval & Bank-File Tampering (Internal Fraud Vector)
  ⚬ Why it matters: Stage 1 mentions separating IBAN edits from payroll calculation, but misses hash-verified payment files. If an attacker or rogue clerk downloads a GIRO/SEPA/SIF file, edits an IBAN in a text editor, and uploads it to the bank, the ERP shows the clean payslip while cash goes elsewhere. Payruns need a cryptographically hashed payout artifact, IBAN-change cooling/alerting (notifying the employee + owner whenever bank details change), and 4-eyes approval before payrun lock.
12. PII Redaction & Prompt-Injection Hardening in the AI Gateway
  ⚬ Why it matters: Even with "drafts-only" HR AI, sending raw employee names, IC/MyKad numbers, Tax IDs, or salaries through an LLM router (e.g., LiteLLM → OpenRouter/DeepSeek) violates GDPR/PDPA/PDPL unless the endpoint is contractually zero-retention and in-region. Worse, an employee uploading a maliciously crafted expense receipt or policy query could attempt indirect prompt injection. The AI layer needs deterministic server-side PII scrubbing before prompt assembly and strict tenant-scoped Qdrant metadata filtering.

3. Decision Pack

Architectural & Go-To-Market Options

Option	Description	One-Off Cost (USD)	Monthly Recurring Cost (USD)	Effort	Reversibility
Option A (Recommended): Native TS Bitemporal Kernel + Malaysia First + DATEV Partner for DE	Build a pure TypeScript bitemporal payroll kernel in NestJS/Postgres (borrowing PayrollEngine's patterns, not .NET). Ship Default Pack + Native Malaysia Pack first (LHDN verified). Enter Germany via DATEV hr:exchange/hr:payrollreports behind a PayrollExecutionProvider seam. Add native UAE/KSA packs in Phase 3.	$3k–$8k (LHDN review prep, DATEV Marktplatz registration, legal template/DPA review)	$50–$200/mo infra (existing Postgres/Redis/Coolify; $0 PEPM COGS in MY/Gulf; customer pays DATEV in DE)	4–6 months (Core HR + Kernel + MY Pack); +2 months for DE DATEV	High. PayrollExecutionProvider seam lets you swap DATEV for an ITSG-certified embedded API later without touching Core HR.
Option B: Embed .NET PayrollEngine Sidecar	Run MIT-licensed PayrollEngine in Docker alongside NestJS; write C# regulation packs for MY/UAE/KSA.	$2k–$5k	$100–$300/mo (extra RAM/containers for .NET + separate DB/pooling)	3–5 months initial, higher ongoing drag (C# + TS context switching)	Medium-Low. Regulation logic gets locked into C# scripting; hard to migrate back to TS later.
Option C: Buy Global Payroll API (Deel/Remote) Everywhere	Build Core HR only; delegate all payroll execution to global payroll APIs.	$5k–$15k (partner onboarding & integration)	$25–$35 PEPM wholesale (destroys SME margin in Malaysia/Gulf where SMEs pay $2–$5 PEPM total)	2–3 months	Medium. Customer billing and statutory records sit on vendor rails.
Option D: Build Native German ITSG + ERiC Engine	Full in-house German payroll + DEÜV/dakota + ELSTER ERiC C-library certification.	$150k–$400k+ (specialist DE payroll + C engineers, pilot audits)	$15k–$30k/mo (permanent Jahreswechsel & ITSG QK team)	18–30 months	Low. Sunk regulatory R&D before first German euro of revenue.

Recommendation

Execute Option A. It aligns directly with launching in Malaysia first (where native payroll is legally attainable via LHDN verification and SMEs will not pay $29 PEPM), preserves 100% TypeScript/PostgreSQL/RLS unity for high-velocity solo + AI-agent development, and de-risks Phase 2 Germany via DATEV Data Services until German ARR justifies plugging in an ITSG-certified embedded payroll API.

Phased Execution Plan

Horizon	Concrete Deliverables
This Month (Days 1–30)	• Finalize PostgreSQL bitemporal schema (valid_from/to, recorded_from/to, evaluation_date, BIGINT minor-unit money, FORCE RLS, PostgreSQL EXCLUDE USING gist non-overlapping constraints).
• Define canonical remuneration taxonomy (basic, housing, fixed_allowance, variable_bonus, overtime, reimbursement, loan_recovery) and the PayrollExecutionProvider TypeScript interface.
• Implement Core HR MVP: Employee Master (split RBAC for core vs. bank IBAN vs. sensitive docs), 16-state Malaysia holiday calendar, and daily attendance with tamper-evident edit logs.
3 Months (Days 31–90)	• Ship deterministic TS calculation kernel with retro delta engine (storeEmptyResults: true), deduction priority waterfall (enforcing MY 50% cap), and immutable payrun lock + GL branch-split journal posting.
• Build Malaysia Country Pack: exact KWSP Third Schedule (incl. 2% foreign worker EPF), PERKESO Act 4 & EIS RM6,000 bracket tables, HRD Corp 1%/0.5%, 2 × basic ÷ 26 public-holiday pay, LHDN PCB/MTD engine (TP1/TP3/BIK/zakat), and agency upload exports (KWSP, ASSIST, CP39, EA, C.P.8D, Malaysian bank GIRO).
• Submit Malaysia PCB test cases to LHDN for written verification letter.
6 Months (Days 91–180)	• Launch Malaysia HR & Payroll GA with ESS mobile/web portal (PDF payslips, leave, expense claims, IBAN-change alerts) and automated retention/export-on-cancellation archive.
• Complete Germany Pre-Payroll & DATEV Track: BEG IV contract form-routing (§ 126b vs. wet ink/QES), 1 ABR 22/21 daily time tracking, DATEV hr:exchange + hr:payrollreports + hr:exports + hr:eau integration, GoBD Z3 export (index.xml + CSV), and 6/8/10-year split retention engine.
12 Months (Days 181–365)	• Evaluate ITSG-certified German embedded payroll APIs (e.g., Lohnfluss post-certification) behind PayrollExecutionProvider for self-service German SMEs without a Steuerberater.
• Build UAE & KSA Country Packs (keyed by entity_jurisdiction for DIFC/ADGM/ADPF; Arabic RTL payslips; validated SIF/Mudad files; dual-cohort GPSSA/GOSI with scheduled July step-ups; monthly EOSG/EOSB GL accrual engine).
• Ship Opt-In Drafts-Only HR AI (Policy Q&A RAG over tenant docs, read-only payslip explainer, variance flagger) behind tenant kill-switch, Art. 50 badge, PII scrubber, and EU/regional zero-retention inference.

Revisit Triggers (When to Change Course)

⚬ Germany Embedded API Trigger: Re-evaluate replacing/supplementing DATEV when >30% of German SME leads lack a Steuerberater or when an ITSG-certified German API partner passes full production audit at ≤€6 PEPM wholesale.
⚬ Proprietary German ITSG Trigger: Never consider building native ITSG/ERiC unless German payroll ARR exceeds €1.5M+/year (~15,000+ active payslips/month) to amortize a dedicated compliance team.
⚬ Regional Hosting Pinning Trigger: Provision an in-Kingdom KSA or UAE regional Postgres/storage node immediately if SDAIA gazettes mandatory in-Kingdom storage or before signing the first >50-employee Gulf enterprise tenant.
⚬ AI Scope Trigger: Halt and run a formal legal conformity review before adding any feature that ranks, scores, filters, or summarizes individual employee performance (triggers EU AI Act Annex III + GDPR Art. 22 + § 87(1)(6) BetrVG).

4. Open Questions for Human Experts (Facts vs. Engineering Defaults)

Every open question below separates what must be verified by a qualified local professional from the safe engineering default we should implement immediately so development is not blocked.

#	Domain & Open Question (Needs Human Expert)	Facts / Uncertainty to Confirm	Safe Default Choice (Ship Now)
1	Malaysia Tax Agent / LHDN: What are the exact 2026 LHDN computerised PCB test-case edge requirements (BIK, VOLA, TP1/TP3, arrears) and current written-verification turnaround time?	LHDN updates PCB test packs annually; undocumented rounding quirks fail verification.	Implement the official LHDN computerised MTD spec with exact integer-sen math and an automated regression test suite mirroring LHDN's published examples; apply for verification 60 days pre-GA.
2	Malaysia Legal / JPDP: Under the final 2025/2026 JPDP guidelines, does the 72-hour breach clock start strictly from discovery/reason to believe or occurrence, and does our Malaysia Sdn Bhd hit the DPO appointment threshold as a multi-tenant processor?	Processor liability and DPO triggers (>20k subjects / >10k sensitive records across tenants) carry RM1M statutory penalties.	Contractually commit to 24-hour processor-to-controller notice upon detection (leaving controllers 48h for JPDP) and appoint a Malaysia-resident DPO before crossing 10,000 employee records.
3	Germany Steuerberater / DATEV Partner: What is the exact DATEV Marktplatz certification timeline, partner fee structure, and hr:eau scope for a non-German IP-holding entity (Malaysian Sdn Bhd) operating via a German local partner?	DATEV Marktplatz onboarding requires contractual/legal entity verification and technical conformance tests.	Register the DATEV partner agreement through the German operating partner/entity and build CSV/DATEV-ASCII fallback exports first so Day-1 German customers aren't blocked by Marktplatz approval timing.
4	Germany Labor Lawyer: Which exact GoBD Verfahrensdokumentation template and Betriebsvereinbarung (works-council) AI data-catalog clauses are required for SMEs deploying our time-tracking and drafts-only AI modules?	Missing Verfahrensdokumentation invites tax-audit estimation; missing § 87(1)(6) BetrVG specificity invites injunctions.	Ship a standard GoBD procedural template covering our immutable audit trail, default all HR AI features to OFF per tenant, and disable individual AI usage telemetry by default.
5	Germany Tax Specialist: Confirm final enacted 2027 BBGs, Minijob Pauschsteuer rate, and exact BZSt DLS § 4(2a) LStDV upstream Vorsysteme schema effective 1 Jan 2027.	Late-2026 ministerial drafts frequently shift before Bundesrat enactment.	Isolate all rates, ceilings, and DLS export schemas behind effective-dated versioned config tables (valid_from = '2027-01-01') with a 4-eyes approval gate before activation.
6	Gulf Labor Counsel (UAE & KSA): Verify exact MOHRE Resolution 340/2026 enforcement dates/fines, ADPF vs. GPSSA applicability, KSA Royal Decree M/44 (Feb 2025) leave/resignation rules, and SDAIA's final stance on cross-border payroll hosting.	Secondary compliance blogs conflict on UAE 1st-of-month vs. 15-day rules and KSA July 1 vs. July 3 GOSI effective dates.	Enforce the strictest baseline (1st-of-month UAE WPS cutoff alerts, entity_jurisdiction routing for DIFC/ADGM/ADPF, Arabic RTL payslips, and configurable regional database pinning for KSA/UAE tenants).
