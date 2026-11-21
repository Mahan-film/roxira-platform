# R26 Gemini Deep Research (second opinion)

This report was pasted by the owner earlier (Gemini Deep Research, dated 21 November 2026) as a single message that holds both stages: Stage 1 (baseline report with sources list) and Stage 2 (skeptical review with a claim audit table, missed risks, decision pack and open questions). It is saved unchanged except: the model's internal "Thoughts" label (the review text follows it directly) is left out, and the citation span markers (`[span_N](start_span)` / `(end_span)`) are removed. No country name needed scrubbing. The R26 digest (PR #1053, 2026-11-21) was very probably written from this same report, so this file is its source text rather than an independent run. All claims are UNVERIFIED by this repo until a lane reads the primary page; see the Second opinion section in `R26_DIGEST.md`.

## Stage 1

Roxira Technical, Regulatory, and Cost Baseline: Verified Facts and Minimal-Budget Recommendations

This report establishes the factual baseline and minimal-budget execution plan for Roxira—a multi-module SaaS platform spanning accounting/tax, CRM, ERP, HR, and an AI legal assistant ("Smart Judge")—built by a two-person team running AI coding agents on macOS and Linux behind a local HTTP proxy. To maintain strict separation between evidence and opinion, Part I compiles verified facts anchored to primary-source URLs and effective or verification dates as of 21 November 2026, while Part II presents architectural, compliance, proxy-workflow, and phased spending recommendations derived from that record.

Four verified findings define the project's immediate constraints. First, an active UK commercial AI legal service already operates under the name SmartJudge.ai, while German legal-services law (§ 2 RDG) and EU AI Act boundaries restrict individualized legal assessment and judicial-support claims. Second, the Digital Omnibus on AI (Regulation (EU) 2026/1744) entered into force on 27 July 2026, postponing Annex III high-risk rules (HR and judicial AI) to 2 December 2027, while leaving Article 50 transparency duties enforceable since 2 August 2026. Third, German accounting interfaces have asymmetric barriers: ELSTER/ERiC is free to integrate and GoBD e-invoicing rules (amended 14 July 2025) are implementable in-house, whereas native German payroll requires paid ITSG/GKV system certification. Fourth, 2026 developer economics shifted sharply: Hetzner raised EU cloud prices twice (April and June 2026) amid entry-tier stockouts, Google Gemini API faces published 2x price increases on 1 December 2026 and 1 January 2027, and both OpenAI Codex CLI and Gemini CLI carry documented HTTP-proxy regressions on Linux and macOS.

Part I: Verified Facts (Primary Sources, URLs, and Dates)

Primary government documents, statutory texts, official vendor documentation, and repository license files are cited directly with their effective or last-updated dates. Where primary pricing pages or official trademark registers were inaccessible or silent—specifically Neon's detailed free-tier limits, Clerk's exact current free-tier ceiling, and EUIPO/DPMA trademark filings—secondary 2026 verification trackers are explicitly labeled as secondary and dated.

1. Brand, Corporate Entities, and Naming Collisions

Public corporate registries and live commercial sites show an active AI legal SaaS operating under the "SmartJudge" name and existing EU corporate entities registered under "Roxira." No official EUIPO, DPMA, or USPTO trademark register search was available in the sources reviewed; trademark clearance across Nice Classes 9, 42, and 45 remains unverified and requires a direct registry query.

Name / Term	Existing Entity or Product	Jurisdiction / Scope	Source URL	Date / Status
SmartJudge (SmartJudge.ai)	Commercial AI decision-support tool for England & Wales divorce financial settlements; operated by WHATWOULDAJUDGESAY LTD (Company No. 15937694, Solihull, UK)	England & Wales (active commercial SaaS; explicitly disclaims legal advice and SRA regulation)	Primary: https://www.smartjudge.ai/terms and https://www.smartjudge.ai/how-smartjudge-was-built	Terms last updated 11 June 2026
"Smart Judge" (legal-tech discourse)	Term widely used in European and international legal-tech literature for AI judicial-assistance and recommender systems	EU / Global academic & judicial discourse	Primary event program: https://www.wu.ac.at/fileadmin/wu/o/ltc/Veranstaltungen/LTS2026/Program_Legal_Tech_Summit_2026.pdf	Legal Tech Summit 2026
UAB "Roxira"	Private limited company (Uždaroji akcinė bendrovė), registration code 307080991	Lithuania (EU)	Primary registry download: https://www.registrucentras.lt/jar/infleid/download.do?oid=299269	Official Centre of Registers extract (undated extract)
ROXIRA CONSTRUCTII SRL	Construction company, CUI 15477041 (Jucu de Sus, Cluj)	Romania (EU)	Secondary directory (ONRC/ANAF mirror): https://verti.ro/firma/15477041/roxira-constructii-srl	Active registry listing

Because SmartJudge.ai publishes its engineering architecture (https://www.smartjudge.ai/how-smartjudge-was-built), it provides a verifiable production reference for legal AI guardrails: it uses Anthropic's Claude strictly against a solicitor-vetted list of leading judgments (never relying on training weights or autonomous web search for legal propositions), restricts published judgments from The National Archives' Find Case Law service to supporting illustrations that may not introduce new legal principles, enforces a pre-release citation-verification gate that blocks report delivery if a corrected draft still fails, deliberately makes no numerical accuracy claim, and contracts for zero model training with 30-day data deletion.

2. Regulatory and Legal Compliance (EU and Germany)

Roxira's five modules intersect four legal regimes in Germany and the EU: the amended EU AI Act, German legal and tax advisory restrictions (RDG and StBerG), German accounting/e-invoicing/payroll compliance (GoBD, UStG, DEÜV), and GDPR cross-border data rules.

Unified Statutory and Regulatory Calendar (Status as of 21 November 2026)

Date	Regime	Binding Milestone	Status (as of 21 Nov 2026)
1 Jan 2025	DE Tax / GoBD	Mandatory B2B e-invoice reception (EN 16931) for all domestic German businesses; invoice retention reduced to 8 years.	Enforceable
2 Feb 2025	EU AI Act	Article 5 prohibitions (including workplace emotion recognition) and Article 4 AI literacy apply.	Enforceable
14 Jul 2025	DE Tax / GoBD	2nd GoBD Amendment takes effect: archiving structured XML suffices for e-invoices; PDF image optional unless carrying extra tax notes.	Enforceable
2 Aug 2025	EU AI Act	General-purpose AI (GPAI) model obligations, governance, and Article 99 penalty framework become applicable.	Enforceable
27 Jul 2026	EU AI Act	Digital Omnibus on AI (Regulation (EU) 2026/1744 of 8 July 2026, OJ 24 July 2026) enters into force, deferring high-risk deadlines.	Enforceable
2 Aug 2026	EU AI Act	General application, Article 50 transparency obligations (including AI user-interface disclosure), and AI Office enforcement powers apply.	Enforceable
2 Dec 2026	EU AI Act	Four-month grace period ends for Article 50(2) machine-readable marking of pre-August 2026 generative systems; new Article 5 prohibition on non-consensual intimate imagery ("nudifier") systems applies.	Imminent (<2 weeks)
1 Jan 2027	DE Tax / GoBD	General B2B e-invoice issuance transition (1 Jan 2025–31 Dec 2026) ends; larger domestic suppliers must begin issuing structured e-invoices.	Imminent (<6 weeks)
2 Dec 2027	EU AI Act	Annex III high-risk AI obligations apply (including employment/worker management and judicial/ADR assistance).	Upcoming
2 Aug 2028	EU AI Act	Annex I product-embedded high-risk AI obligations apply (medical devices, machinery, regulated physical products).	Upcoming
2 Aug 2030	EU AI Act	Final compliance deadline for legacy high-risk AI systems used by public authorities (Article 111(2)).	Upcoming

EU AI Act and the Digital Omnibus on AI

The primary EU AI Act (Regulation (EU) 2024/1689, EUR-Lex consolidated PDF: https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02024R1689-20260727) and the European Commission's official FAQ (https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act) confirm that high-risk rules for Annex III systems now apply from 2 December 2027 and Annex I product-embedded AI from 2 August 2028, while Article 5 prohibitions, GPAI obligations, and general application/transparency rules stayed on their 2025–2026 schedule. Legal analyses published in July–November 2026 (https://williamlaurentavocat.com/en/notes/ai-act-timeline-digital-omnibus/, https://alicelabs.ai/en/insights/eu-ai-act-timeline-2026, https://labs.cloudsecurityalliance.org/research/csa-research-note-eu-ai-act-high-risk-deadline-omnibus-20260/) confirm the amending instrument is Regulation (EU) 2026/1744 of 8 July 2026, published in the Official Journal on 24 July 2026 and in force since 27 July 2026. Note that systems placed on the market after 2 August 2026 do not benefit from the pre-existing-system grace period to 2 December 2026 for Article 50(2) marking. On 22 May 2026, the Commission also published a review report and targeted consultation on high-risk classification guidelines (https://digital-strategy.ec.europa.eu/en/library/report-review-prohibitions-and-high-risk-ai).

Two Annex III categories directly touch Roxira's planned modules (https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02024R1689-20260727, corroborated by October–November 2026 legal guides). First, Annex III Point 4 (Employment, workers' management and access to self-employment) designates AI systems intended for recruitment/selection (targeted job ads, CV filtering, candidate evaluation) and workplace decisions (promotion, termination, behavioral/trait-based task allocation, performance monitoring) as high-risk. Separately, workplace emotion recognition is prohibited outright under Article 5(1)(f) except for medical or safety reasons. Second, Annex III Point 8(a) (Administration of justice) designates AI intended to assist a judicial authority in researching and interpreting facts and law and applying law to concrete facts, or similar use in alternative dispute resolution (ADR).

Under Article 6(3), an Annex III system is exempt from high-risk classification if it poses no significant risk of harm to health, safety, or fundamental rights and performs only (a) a narrow procedural task, (b) improvement of a previously completed human activity, (c) pattern/deviation detection without replacing human review, or (d) a preparatory task—provided the provider documents that self-assessment under Article 6(4) before placing the system on the market. However, any Annex III system that performs profiling of natural persons is always high-risk and cannot invoke Article 6(3). Under Article 99 (reported by secondary legal summaries), fines reach up to €35 million or 7% of worldwide annual turnover for prohibited practices, €15 million or 3% for operator/transparency/high-risk breaches, and €7.5 million or 1% for incorrect or misleading information to authorities; for SMEs (and small mid-caps under the Omnibus for non-prohibition fines), the lower of the two caps applies.

German Legal Services Act (RDG) and Public-Domain Legal Corpora

Under § 2 RDG (Rechtsdienstleistungsgesetz), a regulated legal service covers any activity in concrete third-party matters requiring legal examination of the individual case. In its ruling of 9 September 2021 (BGH, Az. I ZR 113/20, "Smartlaw") (reported by secondary German legal portals https://www.at.legal/rechtsprechung/bgh-urteil-vom-9-september-2021-i-zr-113-20 and https://www.deutscheranwaltspiegel.de/fourword/berufsrecht/rechtsberatung-durch-chatgpt-151199/), the German Federal Court of Justice held that the paid contract generator "Smartlaw" did not provide an impermissible legal service under § 2 RDG, confirming that not every automated handling of law constitutes regulated legal advice. No subsequent BGH judgment addressing generative LLMs under § 2 RDG appeared in the collected sources; German legal commentary flags individualized case analysis by AI as directly implicating § 2 RDG (alongside Steuerberatungsgesetz / StBerG boundaries for tax advisory software).

For legal-data ingestion, German federal statutes (gesetze-im-internet.de, distributed in XML) and official court decisions (rechtsprechung-im-internet.de) are public-domain official works free of copyright under § 5 Abs. 1 UrhG, as documented by German legal-data projects (https://trebatius.de/datenquellen, https://mark-in-euro.de/quellen/, https://artenschutz-lexikon.de/quellen/, verified August–October 2026). European Union legal texts and EUR-Lex CELLAR XML documents (https://eur-lex.europa.eu) are reusable, including commercially, under Commission Decision 2011/833/EU. Third-party curated databases may carry separate database licenses—for example, Open Legal Data (Open Justice e.V.) licenses its database under the Open Database License (ODbL) v1.0.

German Accounting, E-Invoicing (E-Rechnung), GoBD, ELSTER/ERiC, and Payroll Certification

Compliance Domain	Binding Legal / Technical Facts	Source URL	Effective / Issue Date
GoBD (2nd Amendment)	Clarifies structured e-invoice archiving: storing only the structured XML part suffices (Rz. 118, 119, 131), with content rather than pictorial match required. Human-readable PDFs of hybrid ZUGFeRD invoices need only be retained if they carry additional or differing tax-relevant notes (e.g., booking marks, qualified signatures). Converting/deleting XML is prohibited. Outgoing invoice PDF copies need not be saved if an identical copy can be reproduced on demand (Rz. 76). Immutability (§ 146(4) AO), timely booking (10 days for cashless entries per Rz. 47), Z1/Z2/Z3 audit access, and Verfahrensdokumentation remain required.	Primary BMF PDF: https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf?__blob=publicationFile&v=4	14 July 2025 (BStBl I S. 1502; supersedes 11 March 2024 amendment)
Mandatory B2B E-Rechnung	Since 1 Jan 2025, all domestic German businesses (including § 19 UStG Kleinunternehmer) must be able to receive EN 16931 e-invoices (XRechnung/ZUGFeRD); an e-mail inbox suffices and recipients cannot refuse. All mandatory VAT fields (§§ 14, 14a UStG) must reside in the structured XML, not an attached PDF. General issuance transition runs 1 Jan 2025–31 Dec 2026 (phase-in of mandatory issuance begins 1 Jan 2027). Invoice retention dropped from 10 to 8 years (§ 14b(1) UStG; § 147(3) AO per secondary guide), while books/annual accounts stay 10 years and business letters 6 years.	Primary BMF PDF & FAQ: https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf?__blob=publicationFile&v=3 and https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html	15 Oct 2025 (amending 15 Oct 2024, BStBl I S. 1320). Secondary practitioner guides report a third BMF letter on 15 Oct 2026 confirming the 3-tier format/rule/content error split.
ELSTER / ERiC (Tax Interface)	ERiC (ELSTER Rich Client) is a C-library with interface specification provided free of charge by the German tax administration for integration into third-party software.	Primary portal: https://www.elster.de/eportal/infoseite/entwickler	Current official developer portal
German Payroll (ITSG / GKV System Examination)	Software transmitting statutory social-security filings (DEÜV, Beitragsnachweise, eAU) requires formal Systemuntersuchung by ITSG on behalf of GKV (§ 22 DEÜV) and ITSG Trust-Center GKV certificates. Published ITSG ancillary rates: €140/hr net extra consulting, €450 net flat on-site travel, €150/night net lodging/meals (base examination fees are not published on this page and depend on scope agreement). Software must track annual statutory shifts (e.g., €13.90 minimum wage in Jan 2026; 2.9% avg. health-fund Zusatzbeitrag in 2026 per secondary comparisons). Secondary 2026 comparisons list certified cloud payroll add-ons from €12.90–€20/mo (Lexware Office Lohn, Sage Payroll) and payroll bureaus from €8.90/payslip.	Primary portals: https://www.gkv-datenaustausch.de/arbeitgeber/entgeltabrechnung/entgeltabrechnung.jsp and https://gkv-ag.de/systemuntersuchung/preisgestaltung/	Current official portals; competitor pricing verified Aug–Oct 2026 (secondary)

GDPR, EU Data Residency, and LLM Zero Data Retention (ZDR)

As of November 2026, a secondary data-residency audit (https://www.eesel.ai/blog/ai-support-data-residency) notes that the EU-US Data Privacy Framework (DPF) remains in force after the EU General Court upheld it in Latombe v Commission (September 2025), while an appeal (C-703/25 P) remains pending before the CJEU. Routing inference strictly within the EU adds a +10% regional premium where offered—confirmed in OpenAI's primary model pricing docs (https://developers.openai.com/api/docs/models/gpt-6.1-terra) and reported across OpenAI (for models released from 5 March 2026), Azure, Google Vertex AI, and Claude on AWS Bedrock by the November 2026 audit.

Provider / Gateway	Default API Retention & Training	ZDR Availability & Exceptions	EU Inference Residency	GDPR / DPA Notes & Source URLs
Anthropic (Direct API)	Commercial policy deletes API inputs/outputs within 30 days per an Oct 2026 compliance audit (one secondary tracker cites 7 days since Sept 2025, while primary Anthropic docs confirm 30-day retention for Fable/Mythos). Never trains on commercial API data.	Contract addendum via enterprise approval. Primary docs confirm Claude Fable 5.2 requires 30-day retention and excludes ZDR unless expressly authorized, whereas Claude Opus 5 is ZDR-eligible. Excludes Files API and safety-flagged content.	None on direct API (global and us only). EU inference requires AWS Bedrock EU (Frankfurt, Ireland, Paris, Stockholm) or Google Vertex AI eu (+~10%).	A German GDPR consultancy check on 13 Nov 2026 found Anthropic not DPF-certified (relies on EU SCCs requiring a Transfer Impact Assessment): https://aurum-consulting.de/en/2026/claude-gdpr/; primary retention note: https://platform.claude.com/docs/en/models/fable-5-2/migration-guide.
Mistral AI (Direct API)	30 rolling days abuse monitoring; Agents API retained until account closure. Paid API data not trained on except Labs/Preview models or in-app thumbs-up/down feedback.	Stateless API calls only, after approval (an Oct 18, 2026 audit noted Mistral's docs and help center conflict slightly on "paid plans" vs. "pay-as-you-go only"). Excludes Files API.	Opt-in api.eu.mistral.ai processes stateless inference in the EU (control-plane metadata may sit outside the EU).	French/EU entity; primary DPA effective 26 July 2026: https://legal.mistral.ai/terms/data-processing-addendum/.
OpenAI (Direct API)	Up to 30 days abuse monitoring; Responses API retains state 30 days by default. Paid API not trained on.	Requires OpenAI approval for ZDR or Modified Abuse Monitoring (MAM); excludes stateful features.	eu.api.openai.com (EEA & Switzerland) requires MAM/ZDR approval + Modified Retention amendment; +10% on models from 5 Mar 2026; excludes account/usage metadata.	US entity subject to US CLOUD Act; secondary audits verified 18 Oct / Nov 2026: https://www.nodion.com/en/blog/2610-zero-data-retention-llm-api/ and https://www.developersdigest.tech/models/data-retention.
Google Gemini Developer API vs. Vertex AI	Developer API: 55 days policy logging (paid); unpaid tier may train Google products (except EEA/CH/UK per Oct 18, 2026 audit). Vertex AI: No training; flagged prompts up to 90 days (or 30 days by agreement).	Developer API: No ZDR documented. Vertex AI: ZDR via abuse-monitoring exception; disable 24h durable prompt cache per project; Search grounding logs kept up to 3 days with no off switch.	Developer API: No EU residency (transient storage anywhere). Vertex AI: EU multi-region or country region (+10%).	Enterprise Cloud DPA on Vertex AI; secondary verification 18 Oct 2026: https://www.developersdigest.tech/models/data-retention.
EU AI Gateways (e.g., Requesty EU)	Vendor claims 0-day retention and no training.	Vendor claims real-time proxying with zero request/response persistence.	Vendor claims Frankfurt (AWS eu-central-1), routing to EU endpoints of Bedrock, Vertex, Azure OpenAI, Mistral.	Vendor page (unverified independently): https://www.requesty.ai/eu; states Art. 28 GDPR DPA available on request.

3. Open-Source ERP, CRM, Accounting, HR, and Auth Building Blocks

For a hosted SaaS business, the legal distinction between permissive licenses, standard GPLv3, and AGPLv3 is foundational. According to the Free Software Foundation's primary GPL FAQ (https://www.gnu.org/licenses/gpl-faq.html), GPLv3 does not require releasing source code of modified versions used privately without distributing or conveying copies. By contrast, AGPLv3 (Section 13 — Remote Network Interaction) closes that network gap: modifying AGPLv3 software and allowing users to interact with it remotely over a network obligates the operator to offer the corresponding source code of the modified work to those network users.

Project	Domain & Stack	Verified License	SaaS / Commercial Implications	Source URL & Verification Notes
Frappe Framework	Full-stack web framework (Python/JS)	MIT	Permissive; proprietary SaaS allowed with copyright/license notice.	Primary: https://github.com/frappe/frappe/blob/develop/LICENSE
ERPNext	Full ERP (Accounting, Stock, Projects, CRM; Python/Vue; 41.5k GitHub stars)	GPLv3 (note: one secondary blog inaccurately called it MIT)	Hosting without distribution does not trigger AGPL-style network disclosure, but Frappe's trademark policy prohibits commercial use of "ERPNext" branding or domains without permission.	Primary: https://github.com/frappe/erpnext and https://frappe.io/erpnext/license-trademark
Frappe HR (frappe/hrms)	HR & Payroll (13+ modules; Python/Vue; 9.1k GitHub stars)	GPLv3	Same GPLv3 SaaS posture as ERPNext; lacks native German ITSG/GKV payroll certification.	Primary: https://github.com/frappe/hrms
Odoo Community / Enterprise	Modular ERP, CRM, HR (Python)	Community: LGPLv3; Enterprise: Proprietary	Community reports indicate Payroll, Appraisals, Planning, Sign, Documents, and free major-version upgrades are Enterprise-only in Odoo 19/20.	Secondary audits: https://timelinedigi.com/blog/open-source-erp-vs-custom-erp and Reddit user report
TigerBeetle	Distributed double-entry financial ledger DB (Zig; official Node/Go/Java/.NET clients)	Apache-2.0	Permissive with express patent grant; no copyleft obligations.	Primary: https://github.com/tigerbeetle/tigerbeetle/blob/main/LICENSE
Twenty CRM	Modern Notion-style CRM (React/Node.js, GraphQL)	AGPLv3	Network copyleft applies if modified and hosted as SaaS; community thread notes SSO is slated as a paid enterprise discriminator.	Primary homepage: https://twenty.com/; license via secondary audit https://founding.dev/blog/open-source-crm
EspoCRM	Lightweight CRM (PHP)	AGPLv3 (installer Apache-2.0; extension-tools MIT)	Network copyleft applies unless purchasing a commercial license.	Primary: https://github.com/espocrm/espocrm/blob/master/LICENSE.txt, https://www.espocrm.com/espocrm-commercial-license/ (Sept 2026); license text via secondary
Bigcapital	Double-entry accounting & inventory	AGPLv3	Network copyleft applies if modified and hosted as SaaS.	Secondary directory: https://github.com/piotrkulpinski/open-source-alternatives
Horilla HR	HR & ATS (Python/Django/Postgres)	LGPL-2.1	Weak copyleft; modifications to Horilla code itself remain LGPL.	Secondary audit: https://www.opensourcealternatives.to/item/horilla
Better Auth	Embedded TypeScript auth framework (orgs, RBAC, 2FA, passkeys, OIDC/SAML SSO; ~30.5k stars)	MIT (acquired by Vercel 7 July 2026; confirmed staying MIT)	Runs inside your own DB with $0 MAU fees; application-level library (not a multi-app IdP); you own upgrades and breach security.	Secondary trackers: https://devtune.ai/verticals/agent-authentication-identity-for-ai/better-auth and https://publicapis.dev/blog/auth0-alternatives (18 Sept 2026)

For managed authentication alternatives, a secondary pricing audit verified against vendor pages on 18 September 2026 (https://publicapis.dev/blog/auth0-alternatives) reports WorkOS AuthKit at 1,000,000 free MAUs (monetizing Enterprise SSO and Directory Sync separately), Supabase Auth and Logto (MPL-2.0 core) at 50,000 free MAUs, Auth0 at 25,000 free MAUs (then Essentials from $35/mo and Professional from $240/mo), and Keycloak (36,842 GitHub stars) as self-hosted with $0 per-user fees. Secondary trackers conflict on Clerk's free tier (listing either 10,000 MAU or 50,000 monthly retained users, with Pro from $25/mo); Clerk's primary pricing page was not retrieved and should be verified directly before adoption.

4. AI Coding Agents: Proxy Compatibility, Standards, and Q4 2026 Pricing

Local HTTP Proxy Support and Documented Failure Modes (macOS and Linux)

Coding Agent	Proxy Environment Variables & Protocol Support	Documented Caveats & Bugs (2025–2026)	Source URL
Claude Code	Supports HTTPS_PROXY (recommended), HTTP_PROXY, NO_PROXY (space/comma/*), basic auth in URL, NODE_EXTRA_CA_CERTS, CLAUDE_CODE_CERT_STORE (bundled/system), mTLS, and LLM gateway via ANTHROPIC_BASE_URL. Does NOT support SOCKS proxies.	Reads shell env vars once at startup; background agents, Desktop, and claude mcp login require ~/.claude/settings.json. Sandboxing caveat: setting a sandbox port alongside HTTPS_PROXY/HTTP_PROXY does not forward sandboxed command traffic to your upstream proxy. Secondary guide (proxys.io) notes Node.js ≥22.0.0 is required (≥22.15 for OS cert store), missing http:// schemes fail at launch, and lowercase https_proxy overrides uppercase HTTPS_PROXY.	Primary: https://code.claude.com/docs/en/network-config and https://code.claude.com/docs/en/sandboxing
OpenAI Codex CLI	Open-source (Rust/TS, Apache-2.0). Reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY and ~/.codex/.env. Built-in sandbox proxy (codex-rs/network-proxy, HTTP :3128 + SOCKS5 :8081) controls sandboxed commands (allow_upstream_proxy = true to chain per secondary guide).	Open Linux bug (#16079): Codex CLI fails behind an HTTP proxy on Linux in both API-key and device-auth modes (Stream disconnected before completion) even when curl works in the same shell; user workaround was a local HTTP forwarder on 127.0.0.1:9999 via model_providers in ~/.codex/config.toml. Open bug (#39237): respect_system_proxies = true fails to honor macOS system proxy without explicit env vars.	Primary GitHub: https://github.com/openai/codex/issues/16079, #39237, and https://github.com/openai/codex/blob/main/codex-rs/network-proxy/README.md
Gemini CLI	Open-source. Removed --proxy flag in v0.11.0; uses HTTPS_PROXY/HTTP_PROXY env vars or .gemini/.env. No documented SOCKS support.	Regression (#24471): v0.36 broke proxy egress with TypeError: HttpsProxyAgent is not a constructor in ESM bundle (gaxios/clearcut-logger.ts; fix commit referenced May 12). macOS sandbox bug (#19187): failed to pass proxy env vars into sandbox-exec (patched). Auth cutoff: Secondary guides report Google ended personal Google account sign-in (free / AI Pro / Ultra) for Gemini CLI on 18 June 2026, moving personal accounts to Antigravity CLI. Trackers diverge on remaining free limits: one Oct 2026 guide reports an unpaid AI Studio API key gets 250 req/day on Flash models only (with prompts eligible for product improvement), while another snapshot checked 5 Oct 2026 still cites GitHub's legacy 60 req/min / 1,000 req/day quota.	Primary GitHub: https://github.com/google-gemini/gemini-cli/issues/12392, #24471, #19187; auth cutoff via secondary https://www.vibecodeapp.com/docs/guides/gemini-cli
OpenCode	MIT-licensed, 75+ model providers. Supports HTTPS_PROXY, HTTP_PROXY, basic auth, and requires NO_PROXY=localhost,127.0.0.1 to bypass proxy for its local server.	For NTLM/Kerberos proxies, official docs recommend routing through an LLM gateway.	Primary: https://open-code.ai/en/docs/network
Cursor	Supports standard proxies; automatically falls back from HTTP/2 bidirectional streaming to HTTP/1.1 SSE when proxies buffer HTTP/2.	TLS-inspecting proxies must disable response buffering for SSE and long-running timeouts, or exempt cursor.sh, cursorapi.com, cursor-cdn.com, and *.cursorvm.com.	Primary: https://cursor.com/docs/enterprise/network-configuration

Across multi-agent workflows, AGENTS.md is the open cross-tool instruction format stewarded alongside MCP and Goose by the Linux Foundation's Agentic AI Foundation (AAIF) (announced December 2025; adopted across 60,000+ open-source projects by April 2026 per secondary ecosystem reports). AGENTS.md is read natively by Codex CLI (alongside gitignored AGENTS.override.md), Cursor, GitHub Copilot, OpenCode, and Aider, and acts as a fallback or referenced document from CLAUDE.md in Claude Code. Codex CLI silently truncates instruction files exceeding project_doc_max_bytes.

Verified Coding Subscription and Production LLM API Pricing (Q4 2026)

Developer seat plans cluster tightly at $8–$20/month for entry tiers and jump to $100–$200/month for heavy agent usage, while production LLM API output token rates span a 40x range—from $0.50/MTok (claude-haiku-5-5) up to $20.00/MTok (claude-opus-5-5, gpt-5.6-sol, and post-December gemini-4-argon)—with two published Google Gemini API price doublings scheduled for 1 December 2026 and 1 January 2027.

Vendor / Product	Verified Plan / Model Rates (USD)	Key Quotas, Modifiers & Effective Dates	Source URL
Claude Subscriptions	Pro: $20/mo ($17/mo annual, $200 upfront); Max: $100/mo (5x); Ultra / Max 20x: $200/mo; Team: $25/seat ($20 annual) Std / $125 ($100 annual) Prem; Enterprise: $20/seat/mo annual (20-seat min) + API usage.	Free plan excludes Claude Code. Max, Ultra, and Team plans include monthly API credits as of 7 Oct 2026. A secondary pricing analysis (Aug 2026) cites Anthropic data averaging $13/active dev/day (~$260/mo) on metered API Claude Code usage.	Primary: https://claude.com/pricing and https://platform.claude.com/docs/en/release-notes/overview (7 Oct 2026)
Claude API	claude-haiku-5-5: $0.10 / $0.50 per MTok (≤100K; cache hit $0.01; >100K $0.50/$2.50); claude-sonnet-5-5: $2 / $10 (cache hit $0.10, 0.05x); claude-opus-5-5: $4 / $20 (cache hit $0.20, 0.05x); claude-fable-5-2 & mythos-5-2: $8 / $40 (cache hit $0.20, 0.025x). Batch API is 50% off.	Haiku 5.5 launched and Sonnet 5.5 cache reads cut 50% on 7 Oct 2026. All 5.5/5.2 models have 1M context, 128K max output, and June 2026 knowledge cutoff.	Primary: https://platform.claude.com/docs/en/about-claude/pricing and https://platform.claude.com/docs/en/models/overview
GitHub Copilot	Free: $0 (2,000 completions/mo); Pro: $10/mo ($15 AI credits); Pro+: $39/mo ($70 AI credits); Max: $100/mo ($200 AI credits). Secondary Nov 2026 trackers list Business $19/seat and Enterprise $39/seat.	Paid plans include unlimited completions, model selection, and 3rd-party agents (Claude Code & Codex). Secondary trackers note agent/premium models are metered in $0.01 AI credits since 1 June 2026, with Sonnet 5.5 & GPT-6.1 Terra on Pro and Opus 5.5 & GPT-6.2 Astra from Pro+.	Primary: https://github.com/features/copilot/plans; org prices & model lists via secondary https://enjoy.dev/blog/cursor-vs-github-copilot/ (18 Nov 2026)
OpenAI Codex / API	ChatGPT Go: $8/mo (desktop); Plus: $20/mo (web/CLI/IDE/iOS); Business: $20/user/mo annual ($25 monthly, 2+ users); Pro: $100/$200/$500. API: gpt-5.6-sol $4 / $20 (promo through 30 Nov 2026); gpt-6.2-astra $8 in; changelog standard flagship $5 / $25 (cached $0.50) from 5 Oct 2026; gpt-6.1-terra Batch/Flex 50% off, regional +10%.	gpt-6.1-terra prompts >272K incur 2x input/cache and 1.5x output surcharges.	Primary: https://learn.chatgpt.com/docs/pricing, https://developers.openai.com/api/docs/pricing, https://developers.openai.com/api/docs/models/gpt-5.6-sol
Cursor	Free: $0; Plus: $8/mo; Premium: $30/mo (4x Plus + 3rd-party models at API list price); Super: $100/mo (15x); Ultra: $200/mo (50x); Teams: from $30/user/mo.	Secondary Nov 2026 reviews note Plus ($8) covers only Grok/Composer models (following an Aug 2026 restructuring); Claude and GPT access starts at $30 Premium (billed from prepaid credit at API list price).	Primary: https://cursor.com/pricing; model breakdown via secondary https://enjoy.dev/blog/cursor-vs-github-copilot/ (18 Nov 2026)
Google Gemini API	gemini-4-argon: $2 / $10 through 30 Nov 2026, then $4 / $20 from 1 Dec 2026 (no free tier). gemini-3.8-flash & 3.6-flash: $0.75 / $3.75 through 31 Dec 2026, then $1.50 / $7.50 from 1 Jan 2027 (cache storage doubles $0.50 → $1.00/MTok/hr). Secondary Oct 2026 tracker lists gemini-2.5-flash-lite $0.10/$0.40 and 3.5-flash-lite $0.30/$2.50.	gemini-2.5-pro auto-routes to gemini-3.8-flash on 1 Dec 2026 (secondary Nov 5, 2026 summary of Google deprecations page). Search grounding on Gemini 3+: 5,000 free requests/mo shared, then $14/1,000 queries (each request can trigger multiple queries).	Primary rate transition: https://aistudio.google.com/docs/pricing; model mapping via secondary https://www.morphllm.com/gemini-api-pricing (25 Oct 2026) and https://imisofts.com/blog/gemini-2-5-deprecation/ (5 Nov 2026)
Mistral AI API	Mistral Large: $0.50 / $1.50 per MTok; Mistral Small positioned for cost-sensitive workloads.	Open-weight options (Mistral 7B/Mixtral Apache-2.0; Mistral Large 3 675B MoE) self-hostable per secondary tracker.	Primary: https://mistral.ai/pricing/
DeepSeek API	deepseek-flash (V4.1-Flash-1017): Off-peak $0.15 / $0.60 (cache hit $0.003), Peak $0.30 / $1.20 (hit $0.006). deepseek-v4-pro: Off-peak $0.66 / $1.98 (hit $0.022), Peak $1.32 / $3.96 (hit $0.044). OCR API: $0.225 / 1,000 pages.	Off-peak rates are 50% of peak (effective 10 Sept 2026). Supports OpenAI (api.deepseek.com) and Anthropic (api.deepseek.com/anthropic) formats; 1M context.	Primary: https://api-docs.deepseek.com/quick_start/pricing and https://api-docs.deepseek.com/news/news260910/ (10 Sept 2026)

5. Minimal-Budget Infrastructure, Storage, Database, and CI/CD Pricing

European VPS budgeting changed materially in 2026 after Hetzner Cloud executed two price increases (announced 23 February / effective 1 April 2026 across all servers, and announced 27 May / effective 15 June 2026 for new orders and rescales) driven by RAM and NVMe purchase prices, paired with persistent EU stockouts on its cheapest shared lines. Existing servers kept their pre-June rates until rescaled.

Hetzner Cloud 2026 EU-Central Price Progression (Net EUR/Month, Excluding €0.50 Primary IPv4 and VAT)

Source note: Current official IPv4-inclusive prices (CX23 €5.99, CAX11 €6.49, CX33 €8.99) and "not available" flags come from https://www.hetzner.com/cloud/cost-optimized/; historical March/April/June net IPv6-only progressions and October 2026 stock checks come from secondary cloud trackers (c9group.dev, betterstack.com, vpsdex.com, cloudtally.eu, verified 15–21 October 2026).

EU Instance Plan	Mar 2026	1 Apr 2026	15 Jun 2026 (IPv6-only / +IPv4)	Apr → Jun Jump	Oct 2026 EU Ordering Status
CX23 (2 vCPU, 4 GB, 40 GB)	€2.99	€3.99	€5.49 (€5.99 w/ IPv4)	+38% (+84% vs. Mar)	Marked unavailable on public page; limited in Console
CAX11 ARM (2 vCPU, 4 GB, 40 GB)	—	€4.49	€5.99 (€6.49 w/ IPv4)	+33%	Not available / out of stock
CPX22 AMD (2 vCPU, 4 GB, 80 GB)	€5.99	€7.99	€19.49 (€19.99 w/ IPv4)	+144% (+225% vs. Mar)	Orderable
CPX42 AMD (8 vCPU, 16 GB, 320 GB)	—	€25.49	€69.49 (€69.99 w/ IPv4)	+173%	Orderable
CCX13 Dedicated (2 vCPU, 8 GB, 80 GB)	—	€15.99	€42.99 (€43.49 w/ IPv4)	+169%	Orderable
CCX23 Dedicated (4 vCPU, 16 GB, 160 GB)	€23.99	€31.49	€85.99 (€86.49 w/ IPv4)	+173%	Orderable

Core Infrastructure, Storage, Database, and CI/CD Comparison

Service	Free Tier / Entry Cost	Paid Pricing & Key Operational Limits	Data Residency & Caveats	Source URL & Verification Date
Hetzner Cloud	No free tier. Entry EU plans (add €0.50/mo for Primary IPv4; IPv6 free): CX23 €5.49, CX33 (4/8/80) €8.49, CAX11 €5.99, CPX22 €19.49, CPX32 (4/8/160) €35.49, CCX13 €42.99.	Includes 20 TB/mo EU egress (€1.00/TB overage); hourly billing capped at monthly price. Volumes: €0.0572/GB/mo (triple-replicated, no volume snapshots). Snapshots: €0.0143/GB/mo. Daily backups: 20% of server cost. Load Balancer LB11: €7.49/mo. Object Storage (EU): €6.49/mo base (1 TB storage + 1 TB egress, free requests, 64 kB min object, SSE-C only).	German company (Hetzner Online GmbH); EU sites in Falkenstein, Nuremberg, Helsinki. No managed databases; 99.9% compute SLA since 16 March 2026. Server creation restricted since 26 June 2026; CX/CAX lines showed "not available" in Oct 2026.	Primary: https://www.hetzner.com/cloud/cost-optimized/ and https://www.hetzner.com/cloud/; full table & stock via secondary 15–21 Oct 2026
Cloudflare R2	Forever-free Standard tier: 10 GB-month storage, 1M Class A ops (writes/lists), 10M Class B ops (reads), $0 egress.	Standard: $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B, $0 egress. Infrequent Access: $0.01/GB-mo, no free tier, 30-day min, $0.01/GB retrieval, $9.00/M Class A, $0.90/M Class B.	S3-compatible; 99.999999999% durability, 99.9% SLA; supports EU jurisdiction placement; does not implement S3 bucket versioning (secondary comparison).	Primary: https://developers.cloudflare.com/r2/pricing/ and https://www.cloudflare.com/products/r2/ (updated 1 Oct 2026 per secondary)
Supabase (Managed Postgres + Auth)	$0 Free plan: 2 active projects, 500 MB DB/project, 50,000 MAU, 1 GB file storage, 5 GB uncached + 5 GB cached egress, 500k Edge Function calls, 200 realtime connections.	Pro: $25/org/mo (includes $10 compute credit covering 1 Micro 1 GB RAM instance; extra projects from +$10/mo), 8 GB DB ($0.125/GB overage), 100k MAU ($0.00325/MAU), 250 GB egress ($0.09/GB), 7-day daily backups. Add-ons: PITR +$100/mo; Custom domain +$10/mo.	Free projects auto-pause after 1 week of inactivity, have no automatic backups, 1-day logs, and built-in auth e-mail limited to 2/hr to team addresses only (requires custom SMTP).	Primary: https://supabase.com/pricing (verified Nov 2026 via secondary)
Neon (Serverless Postgres)	$0 Free plan: 1 GB Postgres/project (20 GB account total, up to 100 projects), 100 CU-hours/project, 5 GB egress/project, 10 branches/project, scale-to-zero.	Launch metered at $0.106/CU-hour, $0.35/GB storage, 500 GB egress/project ($0.10/GB overage); Scale $0.222/CU-hour.	Frankfurt EU region available. Primary neon.com/pricing (updated 4 Nov 2026) was inaccessible beyond its header; exact quotas come from secondary Oct–Nov 2026 trackers.	Primary header: https://neon.com/pricing (4 Nov 2026); quotas via secondary https://wheredoirunthis.com/products/neon
GitHub Actions (CI/CD)	GitHub Free (personal & org): $12 USD/mo included compute credit for private repos (= 2,000 standard Linux min/mo at $0.006/min, or 1,200 Windows 2-core min at $0.010/min), 500 MB Packages/artifacts, 10 GB cache/repo.	GitHub Pro / Team: $18 USD/mo compute credit (= 3,000 Linux min/mo), 2 GB Packages storage. Self-hosted runners and public-repo standard runners are $0. Hard spend-stop budgets supported.	Copilot code reviews on private repos draw from Actions compute credit in addition to AI credits. Deleting artifacts frees current space but does not erase accrued GB-hours for the billing cycle.	Primary: https://docs.github.com/get-started/learning-about-github/githubs-products, https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions, https://docs.github.com/en/billing/reference/actions-runner-pricing

Part II: Strategic Recommendations and Execution Playbook

All statements in Part II are strategic and engineering recommendations derived from Part I's facts, calibrated for a two-person team minimizing cash burn while avoiding existential legal or operational traps in Germany and the EU.

1. Immediate Risk Triage: Brand, Legal Scope, and Regulatory Boundaries

Before writing production code for regulated modules, close four high-consequence traps that cost nothing to avoid early and are expensive to unwind later.

1. Rename "Smart Judge" immediately and run formal EUIPO/DPMA clearance for "Roxira." Shipping an AI legal assistant called "Smart Judge" collides directly with the active UK commercial service SmartJudge.ai (WHATWOULDAJUDGESAY LTD) and signals judicial authority—which nudges regulators to scrutinize the module under Annex III Point 8(a) of the EU AI Act. Rebrand the module to a neutral, non-judicial name (such as "Roxira Statute & Clause Navigator") and execute a formal DPMA/EUIPO Class 9 and 42 search on "Roxira," verifying whether Lithuania's UAB "Roxira" operates in software.

2. Design the legal assistant strictly inside the RDG and non-Annex-III perimeter. Avoid building an open-ended chatbot that evaluates concrete third-party disputes or predicts court outcomes, which creates direct liability risk under § 2 RDG (and StBerG for individualized tax advice). Instead, target B2B contract-review and statute-lookup workflows—outside judicial/ADR authority—and replicate the deterministic safeguards documented by SmartJudge.ai. Ground outputs exclusively on ingested public-domain primary law (gesetze-im-internet.de XML under § 5 UrhG and EUR-Lex CELLAR XML under Decision 2011/833/EU) plus tenant-uploaded documents, enforce a deterministic pre-release citation-verification gate that blocks output if any cited § or judgment fails lookup against your corpus, and embed Article 50(1) AI interaction notices in the UI plus Article 50(2) machine-readable provenance metadata in exported reports from day one.

3. Keep Roxira HR strictly outside Annex III High-Risk until paying revenue justifies conformity. Full Annex III conformity (risk management system, QMS, CE marking, and EU database registration) before 2 December 2027 would overwhelm a two-person team. Scope v1 HR strictly to administrative records, leave tracking, time logging, onboarding checklists, and non-evaluative text drafting/formatting that qualify as narrow procedural or post-decision support tasks under Article 6(3)(a)/(b). Explicitly omit CV filtering, candidate scoring, behavioral shift allocation, worker performance scoring, and any profiling of natural persons (which bars Article 6(3) automatically), and never add workplace emotion analysis (already prohibited under Article 5(1)(f)). Commit a dated Article 6(4) non-high-risk classification memo to your repository before onboarding external users.

4. Build GoBD/E-Rechnung and ELSTER/ERiC in-house, but do not build native German payroll. Implementing EN 16931 XML generation and parsing (XRechnung/ZUGFeRD), GoBD-compliant append-only ledgers with original XML archiving (per the 14 July 2025 amendment), and later wrapping the free ELSTER ERiC C-library is tractable for two engineers using AI coding agents. Building native German payroll requires formal paid ITSG/GKV Systemuntersuchung plus continuous maintenance of annual health-fund Zusatzbeiträge, contribution ceilings, and DEÜV/eAU schemas. Ship preparatory payroll (vorbereitende Lohnbuchhaltung)—hours, absences, expenses, and clean DATEV/CSV exports—and hand off statutory execution to existing certified providers (€8.90/payslip bureaus or €12.90–€20/mo tools).

2. Recommended Architecture and Build-vs.-Adopt Strategy

A two-person team attempting to stitch together four open-source monoliths across different runtimes (Python/Frappe, PHP/EspoCRM, Node/Twenty, Django/Horilla) will spend its entire budget on integration glue and upgrade debt. Moreover, adopting AGPLv3 codebases (Twenty CRM, EspoCRM, Bigcapital) as modified cores of a proprietary SaaS forces you either to offer your modified source code to every remote SaaS user under AGPL Section 13 or pay for commercial licenses.

Primary Architectural Recommendation: One Modular TypeScript + PostgreSQL Monolith with Zero AGPL Core Dependencies. Keeping frontend, API, background workers, and ORM inside a single strictly typed TypeScript monorepo maximizes AI coding-agent accuracy while minimizing token context waste. Organize Roxira into isolated domain modules (accounting, crm, erp, hr, legal_research) backed by a single EU-hosted PostgreSQL database, unified tenant/RBAC middleware, an immutable audit log, Cloudflare R2 (EU jurisdiction) for GoBD XML archives, an EU-resident LLM inference gateway feeding the citation-verification gate, and clean external boundaries for ELSTER ERiC and certified German payroll exports.

Apply a permissive-first approach to every shared component. For authentication and multi-tenancy, embed Better Auth (MIT) directly in your TypeScript backend and PostgreSQL database: it delivers organizations, RBAC, 2FA, passkeys, and OIDC/SAML SSO with $0 per-MAU fees and keeps user identity tables inside Germany without operating a second identity server. (If you prefer offloading auth maintenance during MVP, WorkOS AuthKit's 1M free MAU tier is the strongest managed fallback, accepting US vendor dependency for auth metadata.) For double-entry accounting, implement an append-only, trigger-enforced double-entry schema with period-closing locks inside PostgreSQL to meet GoBD § 146(4) AO immutability; defer TigerBeetle (Apache-2.0) unless transaction throughput ever exceeds single-node PostgreSQL capacity.

Viable Alternative (Only if You Accept ERPNext's Data Model): If immediate ERP/CRM/accounting feature breadth outweighs UI differentiation, ERPNext + Frappe HR (GPLv3) can legally be operated as a hosted SaaS without triggering AGPL network source disclosure, provided you do not distribute modified software copies and strip all Frappe/ERPNext trademarks. The trade-off is committing your two-person team to Frappe's Python/MariaDB stack and opinionated data model.

3. Two-Machine Dev Setup Behind a Local HTTP Proxy

Because both your Mac and Linux laptops sit behind a local HTTP proxy, standardize your proxy environment once so neither developer loses days to silent agent failures.

1. Bind exclusively to an HTTP forward-proxy listener—never SOCKS. Because neither Claude Code nor Gemini CLI natively supports SOCKS5, ensure your local proxy exposes an HTTP/HTTPS forward-proxy port (http://127.0.0.1:<port>) rather than a SOCKS-only listener.

2. Export both uppercase and lowercase proxy variables plus NO_PROXY identically on macOS and Linux. Because Node/CLI clients can evaluate lowercase https_proxy ahead of uppercase HTTPS_PROXY and reject URLs missing an http:// scheme, maintain a shared shell snippet sourced by ~/.zshrc (Mac) and ~/.bashrc (Linux) that sets HTTP_PROXY, HTTPS_PROXY, http_proxy, and https_proxy to http://127.0.0.1:<port>, and sets NO_PROXY and no_proxy to localhost,127.0.0.1,::1,.local (required by OpenCode's local server). If your local proxy performs TLS inspection, standardize on Node.js ≥22.15 and export NODE_EXTRA_CA_CERTS pointing to your local proxy CA bundle.

3. Apply agent-specific mitigations for documented 2026 proxy bugs. For Claude Code, place your proxy and CA variables inside ~/.claude/settings.json (not only the shell) so background agents and claude mcp login inherit them, and avoid combining a custom sandbox port with HTTPS_PROXY when sandboxed commands require external access. For OpenAI Codex CLI, test connectivity on your Linux laptop before paying for a seat due to open Issue #16079 (HTTP proxy stream disconnects on Linux); if affected, use Claude Code or OpenCode (MIT) on Linux, or route Codex through a local HTTP forwarder in ~/.codex/config.toml. On macOS, export proxy env vars explicitly rather than relying on respect_system_proxies = true (Issue #39237). For Gemini CLI, avoid unpatched v0.36 builds (Issue #24471) and never send proprietary Roxira code through an unpaid AI Studio API key where prompts may be used for product improvement.

4. Commit one concise AGENTS.md (under 200 lines) as the cross-tool source of truth. Put your exact build, type-check, lint, migration, and single-file test commands plus stack versions and GoBD/GDPR invariants in ./AGENTS.md (read natively by Codex, Copilot, Cursor, and OpenCode), and add a two-line ./CLAUDE.md pointing to ./AGENTS.md so both machines and all agents stay aligned without hitting Codex's project_doc_max_bytes truncation limit.

4. Phased Budget Plan: Where to Stay $0 and Where Spending Clearly Pays

Worked Unit Economics for Legal AI Queries

To ground production AI margins without relying on expiring promotional pricing, consider a representative legal-research query with 10,000 input tokens (8,000 cached statute/system tokens + 2,000 uncached user/clause tokens) and 1,500 output tokens, calculated directly from Part I's verified standard API rates:

Model & EU Routing Path	Input Cost / Query (8K cached + 2K fresh)	Output Cost / Query (1.5K tokens)	Cost / 1,000 Queries (USD)	EU Residency & ZDR Posture
Claude Haiku 5.5 ($0.10/$0.50, cache $0.01)	(8k × $0.01 + 2k × $0.10) / 1M = $0.00028	1.5k × $0.50 / 1M = $0.00075	$1.03 (~$1.13 via Bedrock EU +10%)	Ideal for routing, extraction, and citation checks via AWS Bedrock EU.
Mistral Large ($0.50/$1.50, uncached baseline)	10k × $0.50 / 1M = $0.00500	1.5k × $1.50 / 1M = $0.00225	$7.25	Native EU entity + api.eu.mistral.ai + stateless ZDR after approval.
Gemini 3.8 Flash (From 1 Jan 2027) ($1.50/$7.50, cache $0.15)	(8k × $0.15 + 2k × $1.50) / 1M = $0.00420	1.5k × $7.50 / 1M = $0.01125	$15.45 (~$17.00 via Vertex EU +10%)	Doubles from $7.73/1,000 on 1 Jan 2027; requires Vertex EU + cache disabled for ZDR.
Claude Sonnet 5.5 ($2.00/$10.00, cache $0.10)	(8k × $0.10 + 2k × $2.00) / 1M = $0.00480	1.5k × $10.00 / 1M = $0.01500	$19.80 (~$21.78 via Bedrock EU +10%)	High reasoning quality; route via AWS Bedrock Frankfurt (eu-central-1) for EU residency.

A two-tier pipeline—using Claude Haiku 5.5 (~$1.13/1,000 queries) or Mistral Large ($7.25/1,000) for document parsing, query routing, and citation checks, while reserving Claude Sonnet 5.5 via AWS Bedrock EU (~$21.78/1,000) for final legal synthesis—keeps combined AI COGS under $0.025 per legal query with EU-resident inference and zero training. Exclude Claude Fable 5.2 / Mythos 5.2 for GDPR-sensitive tenant prompts because they require 30-day retention and cost 4x Sonnet 5.5, and do not build business models on pre-cliff Gemini 3.8 Flash or Gemini 4 Argon prices scheduled to double by January 2027.

Phased Monthly Cash-Burn Blueprint (2-Person Team)

Keep fixed cash outlays to the minimum set of line items where free tiers fail availability, legal compliance, or engineering velocity (EUR and USD figures are reported in their native billing currencies):

Stack Layer	Stage 0: Build / MVP	Stage 1: First External EU Pilot	Stage 2: Commercial EU SaaS	Spending Rationale
AI Coding Agents (2 Devs)	$20–$40 USD/mo: 2× GitHub Copilot Pro ($20 total; includes $15 credits each + Sonnet 5.5/GPT-6.1 + Claude Code/Codex preview) or 2× Claude Pro ($40/mo; $34/mo annual)	$40–$54 USD/mo: 2× Claude Pro ($34 annual) + 2× Copilot Pro ($20) for cross-model review & completions	$54–$134 USD/mo: Upgrade 1 dev to Claude Max ($100) only when hitting 5-hour Pro caps daily	Clearly pays from day 1. Flat $10–$20 seats avoid ~$260/dev/mo metered API burn. Skip Cursor $30+ unless you specifically rely on Grok ($8 Plus omits Claude/GPT).
Compute & App Hosting (EU)	$0: Local Docker on Mac/Linux + Neon Free (Frankfurt, 1 GB, 100 CU-hr)	€10.69–€23.89 EUR/mo net: 1× Hetzner EU VPS in Nuremberg/Falkenstein (CX33 €8.99 w/ IPv4 if Console stock allows; else CPX22 €19.99 w/ IPv4) + 20% daily backups (€1.70–€3.90)	€43–€52 EUR/mo net: Hetzner CPX32 (8 GB RAM, €35.99 w/ IPv4) or CCX13 dedicated (€43.49 w/ IPv4) + 20% backups	Stay $0 until pilot, then pay Hetzner. Supabase Free pauses after 7 days with no backups. Even post-June hikes, one German Hetzner VPS provides 20 TB egress and EU residency at minimal cost.
PostgreSQL Database	$0: Neon Free (Frankfurt)	$0 incremental: Self-hosted Postgres on the Hetzner EU VPS with encrypted automated pg_dump/WAL backups to R2 EU	$0 incremental (dedicated Hetzner DB VPS + WAL archive) or $25 USD/mo (Supabase Pro, 1 Micro + daily backups)	Keep $0 incremental early. Self-hosting Postgres on your German VPS avoids Supabase's $25 base + $100 PITR add-on while keeping all accounting/HR data in Germany.
GoBD XML & File Storage	$0: Cloudflare R2 Free (EU jurisdiction, 10 GB, 1M writes, 10M reads, $0 egress)	$0–$2 USD/mo: Cloudflare R2 EU Standard ($0.015/GB beyond 10 GB)	€6.49 EUR/mo Hetzner Object Storage (1 TB EU) or R2 EU (~$1.35/100 GB)	Stay $0 on R2 until >10 GB. Zero egress prevents billing spikes when customers download invoices/PDFs; enforce GoBD immutability hashes in application logic.
Auth & Multi-Tenancy	$0: Better Auth (MIT) in Postgres	$0: Better Auth (MIT) + low-cost EU transactional SMTP	$0: Better Auth (MIT, including SAML/OIDC SSO plugin)	Never pay per-MAU fees. Eliminates $25–$240+/mo identity bills as B2B tenants grow.
CI/CD & Repo	$0: GitHub Free ($12/mo compute credit = 2,000 Linux min) with hard spend-stop budget at $0	$0: GitHub Free + self-hosted Linux runner on your own machine/VPS if >2,000 min/mo	$0: Stay on GitHub Free + self-hosted runner	Stay $0. Enable GitHub's "Stop usage when budget limit is reached" immediately to block unintended Copilot code-review Actions charges.
Production Legal AI API	$0–$5 USD/mo: Pay-as-you-go Mistral EU & Haiku 5.5 testing	$5–$15 USD/mo: Pay-as-you-go api.eu.mistral.ai (with ZDR) + Bedrock EU Haiku/Sonnet 5.5	$25–$50 USD/mo (usage-scaled across ~2,000–5,000 queries, funded by tenant fees)	Spend strictly on EU-resident, non-training endpoints. Never route customer legal/tax records through free tiers or non-DPA endpoints.
Estimated Monthly Total	$20–$45 USD	$45–$71 USD + €10.69–€23.89 EUR	$79–$209 USD + €43–€58.49 EUR	Cash stays tightly bounded until customer revenue covers expansion.

Bottom-Line Spending Discipline: Commit your initial cash exclusively to two flat-rate AI coding subscriptions (GitHub Copilot Pro and/or Claude Pro) during Stage 0, adding one German Hetzner VPS only when onboarding your first external pilot tenant. Keep authentication (Better Auth), CI/CD (GitHub Free with hard budget stop), GoBD archive storage (Cloudflare R2 EU Free), tax interface (ERiC), and legal corpora (§ 5 UrhG / EUR-Lex) at $0, and defer native ITSG payroll certification and Annex III high-risk HR AI until paying customers fund their regulatory overhead.




Sources used in the report
  Informacinis leidinys - Registrų centras

  Informacinis leidinys - Registrų centras

  ROXIRA CONSTRUCTII SRL — CUI 15477041 - Verti

  How Was SmartJudge Built and Who Checked It?

  Terms of Service - SmartJudge.ai

  TOWARDS INCORPORATING THE SMART ELECTRONIC JUDGE

  German BERT Model for Legal Named Entity Recognition - arXiv

  genAI in legal practice

  Enterprise network configuration - Claude Code Docs

  Claude Code receives an unsupported SOCKS-only system proxy

  Claude Code Proxy: Setup Guide for the CLI and AI Coding Agent

  How to integrate Claude Code with Lens Loop for local API tracing

  Configure the sandboxed Bash tool - Claude Code Docs

  Inside the Codex sandbox | OpenAI

  gemini-cli 0.11.x and 0.12 preview don't include "--proxy" argument

  No --proxy option · Issue #12220 · google-gemini/gemini-cli - GitHub

  Gemini Proxy Setup: Web App, AI Studio and API - Proxy302

  "TypeError: HttpsProxyAgent is not a constructor" when using proxy

  MacOS sandbox ignores proxy configuration · Issue #19187 - GitHub

  Linux + HTTP proxy: Codex CLI fails in both API key mode ... - GitHub

  codex/codex-rs/network-proxy/README.md at main - GitHub

  Codex Proxy Settings (2026): HTTPS_PROXY, ~/.codex/.env

  respect_system_proxies=true does not make Codex use the macOS

  OpenCode Network Settings: Proxy, SSL & Firewalls

  Gemini Developer API pricing - Google AI Studio

  License and Trademark - Frappe

  frappe/LICENSE at develop - GitHub

  Open-Source ERP (ERPNext, Odoo Community) vs Custom ERP

  frappe/hrms: Open Source HR and Payroll Software - GitHub

  Open Source - ERPNext - Frappe Documentation

  Odoo vs OpenProject vs ERPNext: which open-source ERP fits your

  My company wants to migrate from Odoo Enterprise to Community to

  GitHub - frappe/erpnext: Free and Open Source Enterprise

  espocrm/LICENSE.txt at master - GitHub

  Open Source CRM: Best Options for Devs in 2026 | Founding.dev

  espocrm-installer/LICENSE at master - GitHub

  license - espocrm/extension-tools - GitHub

  Twenty: Self-hosted CRM (alternative to Pipedrive, Salesforce...)

  Twenty | #1 Open Source CRM

  EspoCRM Commercial License

  Tigerbeetle Raises $6.4M to Power the Future of... - daily.dev

  Navigating the AI Act | Shaping Europe's digital future

  EU AI Act: the new timeline after the Digital Omnibus | William Laurent

  EU AI Act's High-Risk Deadline: Deferred, Not Cancelled

  EU AI Act Timeline 2026: Every Deadline After the AI Omnibus

  The EU AI Act Deal: What It Means for Consent Infrastructure

  EU AI Act Omnibus Agreement — Postponed High-Risk Deadlines

  What the EU AI Act requires of companies in 2026 and 2027

  Report on the review of prohibitions and high-risk AI

  E-Rechnung: Neues BMF-Schreiben 2026 | hmd-software AG

  „Digitale Rechtsanwälte“: Wann ist LegalTech ohne Anwalt zulässig?

  BGH-Urteil zu Legal Tech: Ist automatische Vertragsgestaltung

  AI Coding Tools Pricing Comparison 2026: Every Plan Compared

  AI Coding Tools Pricing Comparison 2026 - Developers Digest

  AI Tools by Price 2026: Free to Enterprise | aixjo

  What AI coding tools really cost in 2026: Cursor vs Copilot vs Claude

  GitHub Copilot · Plans & pricing for every developer & team

  Cursor vs GitHub Copilot in 2026: which to pay for, and when

  Cursor · Pricing

  Cheap cloud-hosting – low vps prices for developers - Hetzner

  Hetzner Cloud Review 2026: Prices, Limits, Terms | C9 Group

  Hetzner Cloud pricing 2026: all current prices - CloudTally

  Hetzner Cloud Pricing 2026: Full Price Table After the June Hike

  Cloud-hosting provider for developers & teams - Hetzner

  Hetzner Cloud VPS Pricing Calculator (Nov 2026) - CostGoat

  Hetzner Cloud Review 2026: Benchmarks, Pricing, and the Real

  services with actually generous free tiers for open-source projects

  Zero Data Retention for LLM APIs, Explained - Nodion

  AI API data retention and residency: how long each provider keeps

  Claude GDPR: DPA, Training & EU Processing - AURUM GmbH

  EU AI Gateway: GDPR-Compliant LLM API with EU Data Residency

  AI Provider Comparison 2026: The 12 Best AI Platforms in the GDPR

  Data Processing Addendum - Mistral AI

  AI support data residency in 2026: storage vs AI processing

  Zero Data Retention (ZDR) for LLM Providers | Abu Bakar Siddik

  Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von

  Pricing - Claude Platform Docs

  Prompt caching - Claude Platform Docs

  Claude Fable 5.2 and Claude Mythos 5.2 migration guide

  Models overview - Claude Platform Docs

  Claude Platform release notes

  Plans & pricing | Claude by Anthropic

  Plans & pricing | Claude by Anthropic

  Neon Pricing: Free Plan With 100 Projects, Typical Spend $15/Month

  Pricing & Fees - Supabase

  GitHub Actions billing

  Billing and usage - GitHub Docs

  GitHub's plans

  Actions runner pricing - GitHub Docs

  Product usage included with each plan - GitHub Docs

  Budgets and alerts - GitHub Docs

  Actions limits - GitHub Docs

  tigerbeetle/LICENSE at main - GitHub

  TigerBeetle - GitHub

  TigerBeetle Node.js client - GitHub

  Frequently Asked Questions about the GNU Licenses

  Network Configuration | Cursor Docs

  CLAUDE.md, AGENTS.md, and Every AI Config File Explained

  Karpathy's agents.md: What It Is and Why It Matters - AI Builder Club

  CLAUDE.md, AGENTS.md & Copilot Instructions: Configure Every AI

  Agentic AI Foundation: Guide to Open Standards for AI Agents

  Best Agent Harnesses in 2026: 34 AI Agent Harnesses Compared

  AI Agents vs Agentic AI: The Real Difference | AI Superior

  2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf

  2025-07-14-GoBD-2-aenderung.pdf - Bundesfinanzministerium

  E-Rechnung empfangen und prüfen.XRechnung und ZUGFeRD

  Fragen und Antworten zur Einführung der obligatorischen

  GoBD einfach erklärt: Regeln für Gründer - Firmenkompass

  RIGHTS.md · SNTIQ-Team/lexgraph at main - Hugging Face

  報告書 - デジタル庁

  R2 pricing - Cloudflare Developer Docs

  Better Auth AI search visibility, competitors, reviews, and pricing

  Best Open Source Authentication Tools in 2026

  Clerk Alternatives: 5 Open-Source Options Compared (2026)

  Best Auth0 Alternatives in 2026, Ranked - Public APIs

  hbmartin/comparison-web-app-authentication-providers - GitHub

  Pricing | OpenAI API

  Changelog | OpenAI API

  Pricing - ChatGPT Learn

  GPT-5.6 Sol Model | OpenAI API

  GPT-6.1 Terra Model | OpenAI API

  Pricing - ChatGPT Learn

  Models & Pricing - DeepSeek API Docs

  Pricing - Mistral

  DeepSeek-V4.1-Flash: Smarter, Faster, More Efficient

  Entwickler - ELSTER

  Preisgestaltung ab April 2026 - GKV-AG

  ITSG und das GKV-Zertifikat - eGecko

  Was ist der Unterschied zwischen ELSTER und ERiC?

  Lohnabrechnung Software 2026: 7 Tools im Vergleich - Ordio

  Beste Lohnabrechnungssoftware für den Mittelstand 2026 - Personio

  Gehaltsabrechnung Software 2026: Programme im Vergleich

  Entgeltabrechnung - Systemuntersuchung - GKV-Datenaustausch

  Datenquellen | Trebatius

  API für deutsches Recht: Gesetze & Rechtsprechung | LexAPI

  GitHub - ellmos-ai/rechtsabteilung: Source-grounded AI first-look

  Quellen & Datenstand: Amtliche Grundlagen der Umrechnung

  Quellen und Lizenzen | Artenschutz-Lexikon

  Study on contractual practices affecting the transfer of copyright and

  Cloudflare R2 Pricing in 2026: Storage, Operations, and Real

  Egress-Free Object Storage - Cloudflare R2

  Cloudflare R2 pricing: zero egress, storage & operations

  Cloudflare R2 - Pricing Calculator

  Cloudflare R2 Pricing 2026: Free Tier & Costs vs Raff

  Curated list of open source alternatives to proprietary software.

  Horilla: Open Source Alternative to ADP Workforce Now and Gusto

  Best Open-Source ATS (2026): Self-Hosted Options Compared

  Awesome Selfhosted - GitHub

  GitHub - ishandutta2007/Awesome-Revenue-Recognition-Software

  GNU Affero General Public License - Wikipedia

  Erläuterungen und Fragen zu Open-Source Lizenzen

  What is an AGPL-3.0 license? Can I use it commercially? - Ai0w.com

  Gemini API Pricing (November 2026): Gemini 4 Argon, 3.8 Flash

  How to Use Gemini CLI: Install, Free Limits, and Building Apps (2026)

  Gemini 2.5 Pro and Flash Deprecation: What Changes on December 1

  Supabase Pricing 2026: Free Tier Limits & Costs - CatDoes

  Supabase Free Tier Limits (2026): What You Get and How Pausing

  Supabase Pricing in 2026: What You'll Actually Pay (with Calculator)

  Supabase: what it is, pricing, MCP and RLS security (2026)

  Free Postgres Database: Every Generous Free Tier in 2026 - Voroa

  Neon — pricing, runtime, capabilities - The atlas

  EU AI Act Annex III: the 8 High-Risk Areas and Art. 6(3) Exceptions

  Is Your AI System High-Risk? The EU AI Act Classification Guide

  AI Act Annex III (Annex 3): List, Article 6, Risk Levels - LandingRed

  Commission Draft Worked Examples — High-Risk AI Classification

  AI Act Annex III: which AI systems are high-risk - Vidimus

  High-Risk AI Systems: Annex III and Annex I Explained - ishighrisk ai

  B REGULATION (EU) 2024/1689 OF THE EUROPEAN ... - EUR-Lex

  Dokumentengenerator keine Rechtsdienstleistung – BGH I ZR 113/20

  Rechtsberatung durch ChatGPT? – DeutscherAnwaltSpiegel




Sources read but not used
  Roxira - 成就(undefined) - World of Warcraft

  Roxira - 업적 (undefined) - World of Warcraft - Blizzard Entertainment

  Full page fax print - Sugeval

  [www.Roxel.no](https://www.Roxel.no) - Roxel - Forsidemeny

  Svar på emne - hestemarked.no

  Blue Avian Sen Kat'l, Digital, 2021 : r/conceptart - Reddit

  Full text of "snjeznileopard" - Internet Archive

  Defending Against AI Security Risks by Turning LLM

  Retainer language explicitly banning clients from using AI to check a

  Smartjustice, process and evidence: special reference to its use in

  Quality + Cost Gates + C2PA + EU AI Act Article 50 Disclosure

  Claude Code CLI: The Complete Guide — Hooks, MCP, Skills

  How to Install Claude Code on Windows, Mac and Linux, and Set It

  HTTPS proxy · Issue #4965 - gemini-cli - GitHub

  How to point gemini-cli to a proxy ? · Issue #1457 - GitHub

  Documentation & Configuration Support for Corporate Proxies and

  gemini-cli/packages/cli/src/config/config.ts at main - GitHub

  Support configuring outbound HTTP proxy via http_proxy in config.toml

  Codex CLI: 0.151.0, installed from the official `@openai ... - GitHub

  Use proxy environment variables across Codex HTTP clients #4242

  Image generation and web search bypass the system proxy when

  Current OpenAI, Anthropic & Grok API Prices (2026) - StackSpend

  erpnext/license.txt at develop - GitHub

  ERPNext — Open-Source ERP on the Frappe Framework

  sshcli/My-akaunting: Free and Online Accounting Software - GitHub

  EspoCRM Contributors License Agreements - GitHub

  Was bei der Archivierung von E-Rechnungen jetzt gilt

  GoBD-Änderung: BMF-Schreiben und Verfahrensdokumentation

  E-Rechnung Leistungsbeschreibung: Drittes BMF-Schreiben 2026

  Zulässigkeit von Legal-Tech-Dienstleistungen - Rickert.law

  Best AI Inference Providers for Enterprise (2026 Guide) - DeepInfra

  EU Data Residency for AI Models: GDPR Guide (2026)

  Optimizing for cost and intelligence - Claude Platform Docs

  What's new in Claude Fable 5.2

  Cost Optimization on the Claude API | Claude Cookbook

  What's new in Claude Opus 5.5

  Billing and usage - GitHub Enterprise Server 3.19 Docs

  Product billing - GitHub Docs

  Overview of request-based billing (legacy) - GitHub Enterprise

  Original git history of TigerBeetle, before history was ... - GitHub

  TigerBeetle C#/dotnet client - GitHub

  TigerBeetle Go client - GitHub

  TigerBeetle Java client - GitHub

  https://en.wikipedia.org/wiki/Driver's_license

  https://en.wikipedia.org/wiki/License

  AGENTS.md for GTM: How to Write the Instruction File for Your

  The End of "Human in the Loop" - What Does It Mean for You and Me?

  E-Rechnung Pflicht | Fristen und Ausnahmen - TimeStatement

  Archivierung von E-Rechnungen: Klarstellung veröffentlicht - IHK

  Verfahrensdokumentation GoBD: Checkliste für Agenturen

  Backup oder Archivierung? Unterschied & GoBD-Fristen | HMC

  GitHub - beerbottle90/ArthurLegal: Windows & Mac installer / kurulum

  Simulationsbasiertes Mehrebenen-Planungswerkzeug für

  Volker Wohlgemuth, et. al. (Hrsg.) - EnviroInfo 2025

  Digitalising the Energy Transition | innobu

  Glossary - Charter of Digital Networking - Charta digitale Vernetzung

  Resiliente Agri-Food-Systeme Referate der 43. GIL-Jahrestagung 13.

  6442e7_DHUM002_Study_EU-BR_eJustice_EN.pdf

  BetterAuth vs NextAuth: Choose the Right Auth Library for Your SaaS

  vantagemap/docs/adr/003-authentication.md at main - GitHub

  GitHub - dereknguyen269/free-services: A comprehensive, curated

  Authentication Identity Expert - AI Skill for Any LLM - TypingMind

  Better Auth is joining Vercel | Hacker News

  GPT-6 Cyber Model | OpenAI API

  Build a per-run spending controller with the Responses API

  Fast mode | OpenAI API

  Chat Latest Model | OpenAI API

  Optimizing Customer Support Agents for Cost and Quality

  模型& 价格 - DeepSeek API Docs

  DeepSeek API introduces Context Caching on Disk, cutting prices

  Change Log | DeepSeek API Docs

  DeepSeek-R1 Release

  Introducing DeepSeek-V3

  DeepSeek V4 Preview Release

  DeepSeek API Docs: Your First API Call

  Lohnabrechnung online: Die 5 besten Anbieter im Vergleich 2026

  Dokumentation - Confluence

  The Use of Generative AI in Legal and Related Sectors (Part IV)

  Cloudflare R2 vs AWS S3 | Review Pricing & Features

  Cloudflare R2 Pricing: Costs, Savings, and Alternatives in 2026

  Cloudflare R2 Alternative & R2 Pricing Explained - CDN.COM.TR

  New Project Megathread - Week of 12 Nov 2026 : r/selfhosted - Reddit

  programmify/builder-lab: Discover, learn, and use the best AI, open

  Best Clientence Alternatives & Competitors - SourceForge

  Open-Source Developer Tools & SaaS Alternatives Directory

  Top Self-Hosted Open Source Apps by GitHub Stars (2026)

  awesome-selfhosted

  GitHub - ishandutta2007/Awesome-People-Analytics-Reporting

  4 Best Open Source Payroll Software for 2026 - TechRepublic

  AGPL for software hosted internally : r/opensource - Reddit

  Use and Redistribute AGPLv3 licensed app

  Frequently Asked Questions about the GNU Licenses

  Cloud Native Development, Containers, and Open Source Licensing

  Legal aspects of free and open source software - European Parliament

  Reading the AGPL - Hacker News

  Gemini API Pricing 2026: Complete Per-1M-Token Cost Guide with

  Gemini API Pricing: Cost per 1M Tokens - Cabina.AI

  Claude Code and Codex Proxy Settings, One Proxy per CLI

  my-claude-code/README.md at main - FiredMosquito831 - GitHub

  How to Configure a Proxy for AI Coding Assistants and Domestic LLMs

  Aider Installation & Usage | Debian.Club

  Codex CLI Guide 2026: Setup, Sandbox, AGENTS.md & MCP

  billion-context-pr · Packages - Pi coding agent

  Proxy Server | Headroom - Vercel

  egress-gateway — Apache Magpie Docs

  Supabase Pricing: 2026 Guide to Plans, Limits, and Real-World Costs

  Supabase Free Tier Limits 2026: Database, Projects, Pausing

  Supabase pricing: plans, free tier, and hidden costs - CloudZero

  Regulation - EU - 2024/1689 - EN - EUR-Lex - European Union

  Guidelines on prohibited artificial intelligence practices established

  Regulation (EU) 2024/1689 of the European Parliament ... - EUR-Lex

## Stage 2

Stage 2: Skeptical Senior Review, Primary-Source Audit, and Decision Pack

This review audits the Stage 1 report against primary statutory texts, official vendor documentation, and repository license files as of 21 November 2026. Sections 1 and 2 contain facts only (corrections, unverifiable items, and 12–24-month blind spots). Sections 3 and 4 contain decisions and recommendations, kept strictly separate from facts.

1. Primary-Source Fact Audit (Every Number, Date, Threshold, and Legal Claim)

Audit standard: A claim is marked VERIFIED only when confirmed directly against a primary government, judicial, official vendor, or repository source. Claims backed only by secondary blogs, trackers, or truncated extracts are marked UNVERIFIABLE (noting what secondary evidence exists). Any material discrepancy or missing statutory threshold is marked CHANGED.

Claim from Stage 1	Primary Source URL	Source Date	Status
SmartJudge.ai operated by WHATWOULDAJUDGESAY LTD (Co. No. 15937694, UK), disclaims legal advice/SRA, uses Anthropic Claude against vetted case list, 30-day deletion, no accuracy claim	[https://www.smartjudge.ai/terms](https://www.smartjudge.ai/terms) ; [https://www.smartjudge.ai/how-smartjudge-was-built](https://www.smartjudge.ai/how-smartjudge-was-built)	11 Jun 2026 (Terms); undated (architecture page)	VERIFIED
UAB "Roxira" registered in Lithuania, code 307080991	[https://www.registrucentras.lt/jar/infleid/download.do?oid=299269](https://www.registrucentras.lt/jar/infleid/download.do?oid=299269)	Undated registry extract	VERIFIED (existence/code only; business sector UNVERIFIABLE from extract)
ROXIRA CONSTRUCTII SRL (CUI 15477041, Cluj, Romania)	None retrieved (only secondary mirror verti.ro)	Undated mirror	UNVERIFIABLE against primary ONRC/ANAF registry
Digital Omnibus on AI is Regulation (EU) 2026/1744 (8 Jul 2026, OJ 24 Jul 2026, in force 27 Jul 2026), amending 2024/1689, 2018/1139, 2023/1230	[https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202601744](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202601744) ; [https://eur-lex.europa.eu/legal-content/FR/ALL/?uri=OJ:L_202601744](https://eur-lex.europa.eu/legal-content/FR/ALL/?uri=OJ:L_202601744)	8 Jul 2026 (OJ 24 Jul 2026; effect 27 Jul 2026)	VERIFIED
EU AI Act dates: prohibitions/literacy 2 Feb 2025; GPAI/governance 2 Aug 2025; general application 2 Aug 2026; high-risk Annex III 2 Dec 2027; Annex I product-embedded 2 Aug 2028	[https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act)	Undated live Commission FAQ	VERIFIED (note: operative Article 113 text inside OJ:L_202601744 PDF was not extracted verbatim)
EU AI Act 2 Dec 2026 deadlines (Art. 50(2) pre-existing generative marking grace period; new Art. 5 nudifier/CSAM ban) & 2 Aug 2030 public-authority deadline	[https://eur-lex.europa.eu/legal-content/LV/ALL/?uri=CELEX:32026R1744](https://eur-lex.europa.eu/legal-content/LV/ALL/?uri=CELEX:32026R1744) (confirms Art. 111(4) and Art. 5(1a)/(1b) added 27 Jul 2026, not dates)	27 Jul 2026	UNVERIFIABLE for exact calendar dates in retrieved EUR-Lex text (corroborated only by secondary legal analyses)
Annex III Point 4 (employment) & Point 8(a) (judicial/ADR) high-risk scope, Art. 6(3) derogation, profiling override, Art. 6(4) memo	[https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02024R1689-20260727](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:02024R1689-20260727) ; [https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202601744](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202601744)	27 Jul 2026 / 24 Jul 2026	CHANGED (incomplete in Stage 1): Stage 1 omitted Article 49(2) EU database registration for Art. 6(3) non-high-risk claims, which remains referenced in OJ:L_202601744 (simplification signaled in recitals). Exact Art. 6(3)/(4) text not extracted verbatim from EUR-Lex PDF.
EU AI Act Art. 99 fines (€35M/7%, €15M/3%, €7.5M/1%; lower cap for SMEs & SMCs)	[https://eur-lex.europa.eu/legal-content/LV/ALL/?uri=CELEX:32026R1744](https://eur-lex.europa.eu/legal-content/LV/ALL/?uri=CELEX:32026R1744) (confirms Art. 99(4)(da) and 99(6a) added, without euro figures)	27 Jul 2026	UNVERIFIABLE for exact euro/% figures in retrieved EUR-Lex text (secondary summaries only)
BGH "Smartlaw" judgment (9 Sept 2021, Az. I ZR 113/20) on § 2 RDG	[https://www.bundesgerichtshof.de/SharedDocs/Entscheidungen/DE/Zivilsenate/I_ZS/2020/I_ZR_113-20.pdf?__blob=publicationFile&v=2](https://www.bundesgerichtshof.de/SharedDocs/Entscheidungen/DE/Zivilsenate/I_ZS/2020/I_ZR_113-20.pdf?__blob=publicationFile&v=2)	9 Sep 2021	VERIFIED
German statutes/rulings public domain (§ 5 UrhG); EUR-Lex commercial reuse (2011/833/EU); Open Legal Data (ODbL v1.0)	None directly retrieved (only urhg/__2.html and secondary legal-data sites)	N/A	UNVERIFIABLE directly against primary § 5 UrhG / OJ L 330 texts (consistently reported in secondary German legal sources)
GoBD 2nd Amendment (14 Jul 2025, BStBl I S. 1502): Rz. 76, 118, 119, 131 structured XML archiving suffices; PDF only if extra tax info; no XML-deleting conversion	[https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf?__blob=publicationFile&v=4](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf?__blob=publicationFile&v=4) ; [https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)	14 Jul 2025	VERIFIED (note: 10-day cashless booking rule Rz. 47 and 10y/6y AO periods came from secondary guide, not the 2025 amending PDF)
Mandatory B2B E-Rechnung: reception from 1 Jan 2025; 8-year invoice retention (§ 14b(1) UStG); issuance transition ends 31 Dec 2026; 3rd BMF letter 15 Oct 2026	[https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf?__blob=publicationFile&v=3](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf?__blob=publicationFile&v=3) ; .../2026-10-15-obligatorische-elektronische-rechnung.pdf?__blob=publicationFile&v=2 ; [https://www.gesetze-im-internet.de/ustg_1980/__27.html](https://www.gesetze-im-internet.de/ustg_1980/__27.html)	15 Oct 2025; 15 Oct 2026; current § 27 UStG	CHANGED (missing thresholds & rules added): Primary § 27(38) UStG and BMF FAQ confirm issuers with prior-year turnover ≤ €800,000 have until 31 Dec 2027 (mandatory from 1 Jan 2028), while > €800,000 starts 1 Jan 2027. Primary 15 Oct 2026 BMF letter is now directly VERIFIED: confirms 3-tier error split (Format/Business Rule/Content), confirms non-e-invoice issuance is not a § 26a(2) Nr. 1 UStG fine, extends Endrechnung partial-payment relief to 30 Jun 2030, and grants gross-price relief to 31 Dec 2027.
ELSTER ERiC C-library free to integrate	[https://www.elster.de/eportal/infoseite/entwickler](https://www.elster.de/eportal/infoseite/entwickler)	Undated live portal	VERIFIED
ITSG/GKV payroll Systemuntersuchung (§ 22 DEÜV); €140/hr consulting, €450 travel, €150/night lodging	[https://www.gkv-datenaustausch.de/arbeitgeber/entgeltabrechnung/entgeltabrechnung.jsp](https://www.gkv-datenaustausch.de/arbeitgeber/entgeltabrechnung/entgeltabrechnung.jsp) ; [https://gkv-ag.de/systemuntersuchung/preisgestaltung/](https://gkv-ag.de/systemuntersuchung/preisgestaltung/)	Undated live portals	VERIFIED (base exam fee unpublished; €13.90 min wage, 2.9% Zusatzbeitrag, and competitor payroll prices €8.90–€20/mo are UNVERIFIABLE against primary pages)
Anthropic API retention "30 days (or 7 days per one tracker)"; Fable/Mythos 5.2 exclude ZDR; Opus 5 ZDR-eligible	[https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) ; [https://platform.claude.com/docs/en/models/fable-5-2/migration-guide](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide) ; [https://platform.claude.com/docs/en/release-notes/overview](https://platform.claude.com/docs/en/release-notes/overview)	Undated (privacy/migration); Oct 2026 (release notes)	CHANGED: Primary Anthropic privacy policy states within 30 days (discard the conflicting secondary "7 days" claim). Fable 5.2/Mythos 5.2/5.1 30-day lock & Opus 5 ZDR eligibility VERIFIED. Anthropic DPF non-certification & no direct EU API residency remain UNVERIFIABLE against primary DPF/Anthropic residency docs (secondary audits only).
Mistral DPA (26 Jul 2026), ZDR, api.eu.mistral.ai EU residency, Mistral Large $0.50/$1.50	[https://legal.mistral.ai/terms/data-processing-addendum/](https://legal.mistral.ai/terms/data-processing-addendum/) ; [https://docs.mistral.ai/admin/monitor-comply/zero-data-retention](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention) ; [https://docs.mistral.ai/inference/regional-inference](https://docs.mistral.ai/inference/regional-inference) ; [https://mistral.ai/pricing/](https://mistral.ai/pricing/)	26 Jul 2026 (DPA); undated live docs	CHANGED (key scope limits added): DPA date, $0.50/$1.50, and pay-as-you-go stateless ZDR VERIFIED. Primary regional docs clarify api.eu.mistral.ai uses EU and EFTA data centers, supports function calling as the only tool, excludes Agents/Batch/Files API, and has reduced model availability.
OpenAI API 30-day default retention, no training, eu.api.openai.com (+10% on models from 5 Mar 2026), ZDR compatibility	[https://developers.openai.com/api/docs/guides/data-residency](https://developers.openai.com/api/docs/guides/data-residency) ; .../google-cloud ; .../prompt-caching ; .../tools-programmatic-tool-calling	Undated live docs (5 Mar 2026 cutoff cited)	VERIFIED (also confirms Cloudflare Regional Services for EU TLS termination, exclusion of system/metadata/structured-output schema, and that store: false alone does not enable ZDR)
Gemini Developer API 55-day logging; Vertex AI 90-day flagged / 3-day Search grounding logs / +10% EU	None retrieved (secondary audits only)	Oct–Nov 2026 (secondary)	UNVERIFIABLE against primary Google Cloud / Gemini API terms
EU-US DPF upheld in Latombe (Sep 2025), appeal C-703/25 P pending	None retrieved (secondary blog only)	Nov 2026 (secondary)	UNVERIFIABLE against primary CJEU/General Court docket
Claude subscriptions (Pro $20/$17, Max $100/$200, Team $25/$125, Ent $20+API) & API rates (Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20, Fable 5.2 $8/$40, Batch -50%, 7 Oct 2026 launch)	[https://claude.com/pricing](https://claude.com/pricing) ; [https://platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) ; .../prompt-caching ; .../models/overview ; .../release-notes/overview	7 Oct 2026 (release notes); undated live pricing	VERIFIED (secondary "$13/dev/day" metered Claude Code average remains UNVERIFIABLE against primary Anthropic telemetry)
GitHub Copilot Free $0, Pro $10 ($15 credits), Pro+ $39 ($70), Max $100 ($200), Business $19 (1,900 pooled credits), Enterprise $39 (3,900 pooled credits)	[https://github.com/features/copilot/plans](https://github.com/features/copilot/plans) ; [https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses) ; [https://docs.github.com/en/copilot/get-started/plans](https://docs.github.com/en/copilot/get-started/plans) ; .../seats-and-billing-cycles	Undated live docs	VERIFIED (upgraded from secondary to primary for Business/Enterprise)
OpenAI ChatGPT Go $8, Plus $20, Business $20/$25, Pro $100/$200/$500; API gpt-5.6-sol $4/$20 (promo to 30 Nov 2026), gpt-6.2-astra $8 in, gpt-6.1-terra >272K 2x/1.5x, Batch -50%, regional +10%	[https://learn.chatgpt.com/docs/pricing](https://learn.chatgpt.com/docs/pricing) ; [https://developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing) ; .../models/gpt-5.6-sol ; .../models/gpt-6.1-terra ; .../codex/pricing	5 Oct 2026 (changelog); undated live pricing	VERIFIED
Cursor Free $0, Plus $8, Premium $30, Super $100, Ultra $200, Teams $30+; 3rd-party models at API list price from Premium; HTTP/2→HTTP/1.1 SSE fallback	[https://cursor.com/pricing](https://cursor.com/pricing) ; [https://cursor.com/docs/enterprise/network-configuration](https://cursor.com/docs/enterprise/network-configuration)	Undated live docs	VERIFIED
Google Gemini API 2x price jumps on 1 Dec 2026 ($4/$20) and 1 Jan 2027 ($1.50/$7.50, cache storage $0.50→$1.00); Gemini CLI personal cutoff 18 Jun 2026	[https://aistudio.google.com/docs/pricing](https://aistudio.google.com/docs/pricing) ; [https://developers.google.com/gemini-code-assist/docs/deprecations](https://developers.google.com/gemini-code-assist/docs/deprecations)	Undated live docs	VERIFIED & EXTENDED: Rate jumps and 18 Jun 2026 cutoff confirmed on primary Google pages; primary deprecation table adds 9 Oct 2026 halt on new Standard/Enterprise sales, 31 Jan 2027 annual renewal end, 31 Dec 2027 monthly renewal end. Model-ID mapping (gemini-4-argon, 3.8-flash) and 250 req/day AI Studio free quota rely on secondary trackers.
DeepSeek API off-peak -50% (10 Sep 2026); deepseek-flash $0.15/$0.60 off-peak ($0.30/$1.20 peak); v4-pro $0.66/$1.98 ($1.32/$3.96); OCR $0.225/1k pages	[https://api-docs.deepseek.com/quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing) ; [https://api-docs.deepseek.com/news/news260910/](https://api-docs.deepseek.com/news/news260910/)	10 Sep 2026	VERIFIED
OSS Licenses: Frappe Framework (MIT), ERPNext (GPLv3), Frappe HR (GPLv3), Odoo Community (LGPLv3), TigerBeetle (Apache-2.0), Twenty (AGPLv3), Bigcapital (AGPLv3), Better Auth (MIT, Vercel acquired 7 Jul 2026)	[github.com/frappe/frappe](https://github.com/frappe/frappe); frappe/erpnext; frappe/hrms; odoo/odoo/blob/20.0/LICENSE; tigerbeetle/tigerbeetle; twentyhq/twenty/blob/main/LICENSE; bigcapitalhq/bigcapital; better-auth/better-auth; [vercel.com/blog/vercel-acquires-better-auth](https://vercel.com/blog/vercel-acquires-better-auth)	7 Jul 2026 (Vercel); live GitHub repos	CHANGED (Twenty nuance) / VERIFIED: All eight core licenses now directly verified on primary GitHub/Vercel sources. Twenty CRM correction: core is AGPLv3, client SDK is MIT, and several server modules carry @license Enterprise headers requiring a paid Organization license. EspoCRM core LICENSE.txt body and Horilla main-repo LICENSE were not retrieved verbatim (setup CLI confirmed LGPL-2.1).
Clerk free tier "conflicting 10k MAU vs. 50k MRU" & WorkOS AuthKit 1M free MAU	[https://clerk.com/pricing](https://clerk.com/pricing) ; [https://clerk.com/articles/clerk-pricing-explained](https://clerk.com/articles/clerk-pricing-explained) ; [https://workos.com/compare/auth0](https://workos.com/compare/auth0)	8 Oct 2026 (Clerk article); undated live pricing	CHANGED (resolved): Primary [clerk.com/pricing](https://clerk.com/pricing) confirms 50,000 MRU free (raised from 10k on 5 Feb 2026), Pro $25/mo ($20 annual) incl. 50k MRU + 1 SSO + 1 Directory Sync (extra Directory Sync $75/mo from 1 Jan 2027; extra SSO $75/mo; B2B add-on $100/mo). WorkOS 1M free MAU, $125/mo per SSO/SCIM connection VERIFIED.
Hetzner Cloud EU pricing: CX23 €5.99, CAX11 €6.49, CX33 €8.99 (w/ IPv4, unavailable on public page); CPX22 €19.99; CPX32 €35.99; CPX42 €69.99; CCX13 €42.99; CCX23 €85.99; 20 TB EU traffic, €1/TB overage	[https://www.hetzner.com/cloud/cost-optimized/](https://www.hetzner.com/cloud/cost-optimized/) ; [https://www.hetzner.com/cloud/regular-performance/](https://www.hetzner.com/cloud/regular-performance/) ; [https://www.hetzner.com/cloud/general-purpose/](https://www.hetzner.com/cloud/general-purpose/)	Undated live pricing pages	CHANGED (material price corrections): (1) Primary /cloud/general-purpose/ lists CCX13 from €36.99/mo net (not €42.99) and CCX23 from €73.49/mo net (not €85.99). (2) Primary /cloud/regular-performance/ shows Helsinki (HEL1) is ~15% cheaper than Germany (FSN1/NBG1): CPX22 €16.99 (HEL1) vs. €19.99 (DE); CPX32 €30.49 vs. €35.99; CPX42 €59.49 vs. €69.99; plus entry CPX02 €5.49/€6.49 and CPX12 €9.99/€11.99. (3) Historical Mar/Apr/Jun price-hike %, 20% backup rate, €0.50 IPv4 split, and 99.9% SLA date (16 Mar 2026) remain UNVERIFIABLE against retrieved primary Hetzner pages (secondary trackers only).
Hetzner Object Storage: €6.49/mo net (1 TB + 1 TB egress, free S3 ops, 64 KB min object, "SSE-C only")	[https://www.hetzner.com/storage/object-storage/](https://www.hetzner.com/storage/object-storage/) ; [https://docs.hetzner.com/storage/object-storage/overview/](https://docs.hetzner.com/storage/object-storage/overview/)	Undated live docs	CHANGED (major capability missed): Base price (€6.49/mo, €0.0104/hr), 1 TB storage/egress, €0.0087/TB-hr storage overage, €1.00/TB egress overage, free S3 ops, and 64 KB min object VERIFIED. CORRECTION: Primary docs confirm native S3 Object Lock (WORM: Retention + Legal Hold) and Object Versioning (vital for GoBD) plus optional server-side encryption (SSE-C documented).
Cloudflare R2 Free (10 GB, 1M Class A, 10M Class B, $0 egress) & Paid ($0.015/GB, $4.50/M, $0.36/M, IA $0.01/GB + $0.01 retrieval)	[https://developers.cloudflare.com/r2/pricing/](https://developers.cloudflare.com/r2/pricing/) ; [https://www.cloudflare.com/products/r2/](https://www.cloudflare.com/products/r2/)	Undated live docs	VERIFIED (note: 99.999999999% durability, 99.9% SLA, and absence of S3 bucket versioning came from secondary comparison)
Supabase Free ($0, 2 projects, 500 MB DB, 50k MAU, 1 GB storage, 5 GB+5 GB egress, pauses after 1 wk) & Pro ($25/mo incl. $10 compute credit, 8 GB disk, 100k MAU, 250 GB egress, 7-day backups)	[https://supabase.com/pricing](https://supabase.com/pricing)	Undated live pricing	VERIFIED (sub-items: $100 PITR, $10 custom domain, 500k Edge Functions, 2/hr SMTP limit remain UNVERIFIABLE against retrieved primary snippet)
Neon Free (1 GB/project, 20 GB total, 100 CU-hrs, 100 projects, 5 GB egress, 10 branches) & Launch ($0.106/CU-hr, $0.35/GB, 500 GB egress); Scale ($0.222/CU-hr)	[https://neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans) ; .../cost-optimization ; .../agent-plan	4 Nov 2026 ([neon.com/pricing](https://neon.com/pricing) inaccessible); live docs	CHANGED / PARTIALLY UNVERIFIABLE: $0.106/CU-hr (Launch), $0.222/CU-hr (Scale), $0.35/GB-mo storage, and 10 branches on Free/Launch VERIFIED. Free-tier GB/CU-hr limits are UNVERIFIABLE (primary /pricing inaccessible). Discrepancy: Primary agent-plan doc lists 100 GB/project public transfer on Launch-rate tier and 500 GB/project on Scale, contradicting secondary claims of 500 GB on Launch.
GitHub Actions Free ($12/mo = 2,000 Linux min at $0.006/min; Windows $0.010/min), Pro/Team $18/mo, self-hosted $0, hard stop budgets, Copilot review consumes Actions compute	[https://docs.github.com/get-started/learning-about-github/githubs-products](https://docs.github.com/get-started/learning-about-github/githubs-products) ; .../about-billing-for-github-actions ; .../actions-runner-pricing ; .../budgets-and-alerts	Undated live docs	VERIFIED
Proxy support & bugs: Claude Code (no SOCKS, startup-read, settings.json, sandbox port caveat), Codex CLI (#16079 Linux HTTP fail, #39237 macOS system proxy), Gemini CLI (#12392, #24471, #19187), OpenCode (NO_PROXY required)	[code.claude.com/docs/en/network-config](https://code.claude.com/docs/en/network-config) & sandboxing; [github.com/openai/codex/issues/16079](https://github.com/openai/codex/issues/16079) & #39237; [github.com/google-gemini/gemini-cli/issues/12392](https://github.com/google-gemini/gemini-cli/issues/12392), #24471, #19187; open-code.ai/en/docs/network	Live docs & GitHub issues	VERIFIED (secondary-only details: Node ≥22.15 & lowercase https_proxy precedence, Codex allow_upstream_proxy, and AGENTS.md Linux Foundation AAIF stats remain UNVERIFIABLE against primary LF/vendor pages)

2. What the Report Missed That Will Hurt Us in 12–24 Months (Factual Gaps)

The following 12 verified statutory, commercial, and operational blind spots were absent or under-scoped in Stage 1 and will directly affect Roxira between December 2026 and November 2028.

1. EU Product Liability Directive (Directive (EU) 2024/2853) Applies from 9 December 2026 (18 Days Away)
  ⚬ Primary source: [https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32024L2853](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32024L2853) and EUR-Lex summaries (adopted 23 Oct 2024; applies to products placed on the market or put into service from 9 December 2026).
  ⚬ Why it hurts: Explicitly brings software and AI systems under EU no-fault strict liability (including safety-relevant cybersecurity defects) and introduces court-ordered evidence disclosure against software manufacturers. The open-source carve-out applies only outside commercial activity. Boilerplate SaaS "as-is" disclaimers will not neutralize strict liability for defective commercial AI outputs or insecure accounting software; E&O/cyber insurance and defensible release QA become mandatory.
2. EU Cyber Resilience Act (Regulation (EU) 2024/2847) — Vulnerability Reporting Already Active (11 September 2026); Full Scope 11 December 2027
  ⚬ Primary source: [https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202402847](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202402847) and EUR-Lex summary (reporting obligations active 11 September 2026; full secure-by-design, SBOM/risk-assessment, CE-marking, and fines up to 2.5% of global turnover from 11 December 2027).
  ⚬ Why it hurts: Pure cloud SaaS sits outside most CRA product duties, but shipping any downloadable Roxira desktop client, mobile HR app, on-premise ERP connector, or local ELSTER/ERiC bridge agent turns Roxira into a regulated "product with digital elements" subject to 24-hour/early-warning CSIRT vulnerability reporting and mandatory lifecycle security patches.
3. EU Data Act (Regulation (EU) 2023/2854) Bans Cloud/SaaS Switching Charges from 12 January 2027 (7 Weeks Away)
  ⚬ Primary source: [https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202302854](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202302854) and OJ:L_202602394 (12 January 2027 prohibition on switching charges).
  ⚬ Why it hurts: Starting 12 January 2027, SaaS providers cannot impose switching/export fees and must support structured customer exit. Without self-service full-tenant export (GoBD XML + CSV/JSON ledgers, CRM, HR, documents) built into the core schema early, retrofitting compliant exit across five coupled modules will burn weeks of engineering time under threat of regulatory complaint.
4. EU AI Act Article 49(2) Public Registration Duty for Article 6(3) "Not-High-Risk" Systems
  ⚬ Primary source: [https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202601744](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202601744) (recitals referencing Art. 49(2) registration of Art. 6(3) systems), corroborated by Nov 2026 compliance analyses.
  ⚬ Why it hurts: Stage 1 implied an internal Git memo satisfies Article 6(3)/(4). In fact, relying on Article 6(3) for any Annex III domain (HR or legal) triggers a public EU database registration duty under Article 49(2) (subject to Omnibus simplification mechanics) and exposes the claim to Article 80 authority reassessment and up to €7.5M/1% fines for misleading filings.
5. German Works Council Co-Determination (§ 87 Abs. 1 Nr. 6 BetrVG) Stalling Mittelstand B2B Deals
  ⚬ Primary statutory anchor: [https://www.gesetze-im-internet.de/betrvg/__87.html](https://www.gesetze-im-internet.de/betrvg/__87.html) (cited in Nov 2026 German legal review).
  ⚬ Why it hurts: Any German customer with a Betriebsrat cannot deploy software technically capable of monitoring employee behavior or performance—which automatically includes HR time tracking, CRM sales activity logs, ERP task logs, and AI prompt telemetry—without a Betriebsvereinbarung (or Einigungsstelle arbitration). Without a "zero-employee-tracking / Betriebsrat-ready" toggle and documentation pack, German B2B sales cycles stall for 6–12 months.
6. DATEV Ecosystem Gatekeeping and Per-Client Fees (DATEV Buchungsdatenservice)
  ⚬ Primary source: [https://www.datev.de/web/de/shop/produkt-details/datev-buchungsdatenservice-91000](https://www.datev.de/web/de/shop/produkt-details/datev-buchungsdatenservice-91000) and [https://www.datev.de/web/de/marktplatz/datev-schnittstellen-anbieter](https://www.datev.de/web/de/marktplatz/datev-schnittstellen-anbieter).
  ⚬ Why it hurts: German tax advisors (Steuerberater) rarely accept raw CSV exports at scale; they require DATEV Buchungsdatenservice integration (requiring formal DATEV Marktplatz technical verification) plus customer-paid DATEV monthly fees (€1.36/mo for ≤500 postings up to €15.75/mo for 10,000, plus mandatory DATEV Belege online Art.-Nr. 95157). Practitioner reviews on DATEV's own marketplace flag that simplistic account mappings fail on German § 13b UStG reverse-charge, 0% VAT, and private-car-use bookings.
7. German Open Banking (PSD2/XS2A) Cash Cost, 19–36% Bank Breakage, and Consent Churn
  ⚬ Secondary operational & vendor audits: europeanpurpose.com (27 Oct 2026), norman.finance live telemetry of 818 German business connections (Jul–Oct 2026), fynteq.com (10 Jun 2026).
  ⚬ Why it hurts: Accounting SaaS without automated German bank feeds loses almost every SME deal. Yet BaFin-licensed finAPI costs €100/mo for B2X (≤200 users) and €500/mo (≤1,000 users) on published tiers (enterprise floors ~€2,000/mo). Worse, 36% of Volksbank/cooperative bank and 19% of Sparkasse connections break within 30 days, and PSD2 consents expire every 90–180 days, creating relentless Level-1 support load for a two-person team.
8. EU ViDA (Directive (EU) 2025/516 & Regulation (EU) 2025/517) and Germany's Planned Domestic Reporting System
  ⚬ Primary sources: [https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202500516](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=OJ:L_202500516) and OJ:L_202500517 (adopted 11 Mar 2025; staggered rollouts 1 Jul 2028, 1 Jul 2029, and mandatory EU cross-border digital reporting / central VIES on 1 Jul 2030); BMF FAQ confirming Germany's e-invoice mandate prepares a domestic transaction Meldesystem.
  ⚬ Why it hurts: Designing Roxira's invoice/VAT engine purely for 2025–2026 domestic PDF/XML storage without structured EN 16931 Business Term (BT/BG) persistence (recommended by BMF 15 Oct 2026) will force an expensive schema migration within 18–24 months.
9. GoBD WORM Immutability Gap on Cloudflare R2 vs. Hetzner Object Storage
  ⚬ Primary sources: [https://www.hetzner.com/storage/object-storage/](https://www.hetzner.com/storage/object-storage/) and [https://docs.hetzner.com/storage/object-storage/overview/](https://docs.hetzner.com/storage/object-storage/overview/) (native S3 Object Lock / WORM Retention + Legal Hold and Object Versioning inside Germany; €6.49/mo net, 64 KB min billable object) vs. secondary audit noting Cloudflare R2 lacks S3 bucket versioning.
  ⚬ Why it hurts: Storing 8-year GoBD tax archives on mutable buckets without storage-layer WORM Object Lock creates audit friction during a German Betriebsprüfung—while naively storing millions of 15 KB XML files individually on Hetzner Object Storage triggers 4x minimum-object billing (64 KB floor) and violates Hetzner's ≥1 MB file-size performance guidance.
10. Mistral EU Regional Restrictions and 12-Month AI Vendor/Model Churn
  ⚬ Primary sources: [https://docs.mistral.ai/inference/regional-inference](https://docs.mistral.ai/inference/regional-inference) (EU endpoint runs across EU and EFTA, supports function calling only, excludes Agents/Batch/Files API, and limits model selection); [https://platform.claude.com/docs/en/models/overview](https://platform.claude.com/docs/en/models/overview) (retirement floors Sep–Nov 2027, <12 months away); [https://platform.claude.com/docs/en/release-notes/overview](https://platform.claude.com/docs/en/release-notes/overview) (Haiku 5.5 broke backward compatibility with Haiku 4.5 parameters); [https://developers.google.com/gemini-code-assist/docs/deprecations](https://developers.google.com/gemini-code-assist/docs/deprecations) (Code Assist Standard/Enterprise sales halted 9 Oct 2026).
  ⚬ Why it hurts: Coupling Roxira's backend directly to one LLM vendor's stateful API or SDK parameters guarantees forced production migrations inside 12 months.
11. Unbudgeted Official Trademark Fees (Nice 13th Edition, Effective 1 Jan 2026)
  ⚬ Primary sources: [https://www.dpma.de/en/protect/trade-marks](https://www.dpma.de/en/protect/trade-marks) (€290 online for up to 3 classes; +€200 accelerated exam); [https://www.euipo.europa.eu/en/trade-marks/before-applying/fees-payments](https://www.euipo.europa.eu/en/trade-marks/before-applying/fees-payments) (€850 1 class, €900 2 classes, €1,050 3 classes); [https://www.euipo.europa.eu/en/news/new-edition-of-the-nice-classification](https://www.euipo.europa.eu/en/news/new-edition-of-the-nice-classification) (13th Edition active 1 Jan 2026).
  ⚬ Why it hurts: Stage 1 budgeted €0 for IP protection. Building 12–24 months of domain authority and customer contracts under an unsearched/unregistered name ("Roxira" vs. Lithuanian UAB "Roxira") risks a cease-and-desist forced rebrand.
12. Five-Module Scope Explosion + AI Stability Penalty + Single-Node Hetzner Operational Risk
  ⚬ Primary/verified sources: Google Cloud / DORA research reports a 25% rise in AI adoption correlates with -1.5% delivery throughput and -7.2% delivery stability without rigorous automated testing; Hetzner Cloud has no availability zones, no managed PostgreSQL, and restricted new server creation since 26 June 2026.
  ⚬ Why it hurts: Two engineers shipping five regulated modules simultaneously with AI agents onto one self-managed VPS without automated restore drills and integration-test gates will drown in regression bugs, schema migrations, and downtime by Month 12.

3. DECISION PACK (Recommendations & Execution Plan)

Everything in Sections 3 and 4 is a recommendation or strategic judgment, strictly separated from the verified facts above. Costs are shown in native billing currencies (EUR net excl. VAT; USD list price).

Decision Matrix

D1. Product Scope & Module Sequencing (Surviving as a 2-Person Team)

⚬ Options: (A) Build all 5 modules in parallel; (B) Ship Accounting/E-Rechnung + CRM first (wedge), add lightweight ERP/Inventory + Admin-only HR in Phase 2, and ship the renamed Legal/Statute Navigator strictly as a B2B document/statute lookup add-on; (C) Fork ERPNext + Frappe HR (GPLv3) and build only the legal assistant.
⚬ Recommendation: Option B. Five regulated domains simultaneously will break a two-person team. German B2B E-Rechnung mandatory issuance (1 Jan 2027 for >€800k; 1 Jan 2028 for ≤€800k) creates immediate buying urgency for an accounting + CRM wedge without triggering Annex III AI Act or ITSG payroll blockers.
⚬ Cost: One-off €0; Monthly €0 incremental.
⚬ Effort: Saves 6–9 person-months of premature maintenance.
⚬ Reversibility: High (shared modular TypeScript monorepo allows activating erp and hr packages as revenue funds them).
⚬ Revisit Trigger: ≥15 paying B2B tenants requesting integrated inventory or HR onboarding, OR reaching €5k MRR.

D2. Brand & Legal AI Assistant Positioning ("Smart Judge")

⚬ Options: (A) Keep "Smart Judge" and offer case-outcome evaluation; (B) Rename immediately to a neutral non-judicial name (e.g., Roxira Rechts- & Vertragsrecherche / Clause & Statute Navigator), restrict strictly to primary-law lookup + clause comparison with deterministic citation gating, and file DPMA trademark; (C) Drop legal AI completely until Series A.
⚬ Recommendation: Option B. Eliminates immediate collision with SmartJudge.ai, stays outside Annex III Point 8(a) (judicial/ADR), stays on the safe side of § 2 RDG / BGH I ZR 113/20, and requires only Art. 50(1)/(2) transparency markings.
⚬ Cost: One-off €290 DPMA online filing (3 classes) + ~€600–€1,200 optional trademark/RDG lawyer review (or €850–€1,050 EUIPO if EU-wide from day 1); Monthly €0.
⚬ Effort: 1–2 days (rename + Art. 50 UI banners + deterministic XML/citation gate).
⚬ Reversibility: Low after public launch (rebranding post-launch is expensive); High right now pre-launch.
⚬ Revisit Trigger: First non-DACH EU customer (upgrade DPMA to EUIPO) OR any feature proposal that scores legal risk on concrete third-party facts (requires RDG counsel sign-off).

D3. Core Codebase Architecture & Open-Source Licensing

⚬ Options: (A) Stitch together AGPLv3 apps (Twenty CRM + Bigcapital + Horilla); (B) Single Modular TypeScript + PostgreSQL Monolith using strictly permissive (MIT/Apache-2.0) libraries; (C) Re-skin ERPNext + Frappe HR (GPLv3, Python/MariaDB).
⚬ Recommendation: Option B. Avoids AGPLv3 Section 13 network source-disclosure obligations, avoids Twenty's proprietary @license Enterprise gates, avoids multi-runtime DevOps tax, and maximizes AI coding-agent reliability across one TypeScript repo. Build EN 16931 XML (BT/BG mapped per BMF 15 Oct 2026) + GoBD append-only ledger + EU Data Act JSON/XML tenant exporter as core primitives from Week 1.
⚬ Cost: One-off €0; Monthly €0.
⚬ Effort: 4–6 weeks for core multi-tenant + ledger + E-Rechnung foundation.
⚬ Reversibility: Low after Month 6.
⚬ Revisit Trigger: Only reconsider TigerBeetle (Apache-2.0) if ledger writes exceed >1,000 TPS, or ERPNext if you pivot to a custom-ERP agency model.

D4. Authentication & Multi-Tenancy

⚬ Options: (A) Better Auth (MIT) embedded in Postgres; (B) Clerk (50k free MRU, Pro $25/mo, +$75/mo per extra SSO/Directory Sync from Jan 2027); (C) WorkOS AuthKit (1M free MAU, $125/mo per SSO/SCIM connection).
⚬ Recommendation: Option A (Better Auth, MIT) for core identity/orgs/RBAC/2FA/SSO inside your EU PostgreSQL database—keeping all user PII inside Germany with $0 MAU fees and zero per-connection SSO fees. Keep auth behind a thin internal AuthService adapter in case enterprise buyers later demand SCIM Directory Sync via WorkOS.
⚬ Cost: One-off €0; Monthly €0 (plus ~€0–€5/mo EU transactional SMTP).
⚬ Effort: 2–3 days setup + automated auth security tests in CI.
⚬ Reversibility: Medium (user/session tables stay in your own Postgres; migrating to WorkOS/Clerk later requires password-hash export or OIDC re-link).
⚬ Revisit Trigger: First enterprise tenant demanding automated SCIM Directory Sync (evaluate WorkOS per-connection pass-through billing at $125/mo).

D5. Compute, Database, and GoBD WORM Storage (Correcting Stage 1's R2 & Hetzner Blind Spots)

⚬ Options: (A) Neon Free (dev) → Hetzner EU VPS (CPX22 in HEL1 €16.99 or DE €19.99; or CX33 €8.99 if stock opens) + self-hosted Postgres + Hetzner Object Storage (€6.49/mo net) with S3 Object Lock (WORM) for GoBD archives + Cloudflare R2 Free (EU) for mutable app uploads/previews; (B) Supabase Pro ($25/mo + $100/mo PITR) + R2; (C) Hetzner CCX13 dedicated (€36.99/mo net) from day 1.
⚬ Recommendation: Option A. Specifically override Stage 1's R2-only GoBD recommendation: once the first paying German tenant goes live, archive daily bundled GoBD e-invoice XML + ledger hash-chain packs onto Hetzner Object Storage (€6.49/mo net) with S3 Object Lock (8-year Retention) inside Nuremberg/Falkenstein. Bundling daily tenant XMLs into compressed archives (>1 MB) with a manifest solves both Hetzner's 64 KB minimum-object billing floor and its ≥1 MB file-size recommendation, while keeping mutable PDFs/avatars on Cloudflare R2 Free ($0). Use Helsinki (HEL1) for staging (CPX22 €16.99 vs. €19.99 DE) and Nuremberg/Falkenstein for production, with automated encrypted WAL backups to the alternate site to mitigate Hetzner's lack of availability zones.
⚬ Cost: Stage 0 (Dev): €0 (local Docker + Neon Free Frankfurt + R2 Free). Stage 1 (First Pilot): €26.48–€30.48/mo net (CPX22 DE €19.99 + Hetzner Object Storage WORM €6.49 + ~€4 backups/snapshots). Stage 2 (Scale): €43.48–€50/mo net (CCX13 from €36.99 + Object Storage €6.49).
⚬ Effort: 3 days (Terraform/Coolify/Docker Compose + WAL-G backup + quarterly automated restore drill).
⚬ Reversibility: High (standard Postgres + S3 API; zero PaaS lock-in).
⚬ Revisit Trigger: DB size >50 GB, sustained CPU >70% (move to CCX13 €36.99), or customer contractual SLA >99.9% (add second standby node in second Hetzner region).

D6. AI Coding Agents & Two-Machine HTTP Proxy Stack

⚬ Options: (A) 2× GitHub Copilot Pro ($20/mo total) + 1–2× Claude Pro ($17–$20/dev/mo) + OpenCode (MIT, $0) as Linux proxy fallback; (B) 2× Cursor Premium ($60/mo + API overages); (C) 2× ChatGPT Plus / Codex CLI ($40/mo).
⚬ Recommendation: Option A (start with 2× Copilot Pro $20 + 2× Claude Pro $34 annual = $54/mo USD, or $40/mo if starting with Claude Pro only). Skip Cursor ($30+ needed for Claude/GPT) and do not rely on Codex CLI on the Linux laptop until GitHub Issue #16079 (HTTP proxy stream disconnects) is tested and closed. Enforce AGENTS.md (<200 lines) + symlinked CLAUDE.md, strict HTTP-only proxy vars (HTTP_PROXY/HTTPS_PROXY + lowercase + NO_PROXY=localhost,127.0.0.1,::1), ~/.claude/settings.json proxy config, and mandatory CI unit/integration tests on every AI-authored PR to counter DORA's -7.2% AI stability drop. Set GitHub Actions hard spend-stop budget to $0 above the $12/mo free compute credit.
⚬ Cost: One-off €0; Monthly $20–$54 USD.
⚬ Effort: Half-day setup for shared dotfiles + AGENTS.md + CI test gates.
⚬ Reversibility: Very High (monthly subscriptions, AGENTS.md is portable).
⚬ Revisit Trigger: Daily 5-hour cap hits on Claude Pro (upgrade heavy dev to Claude Max $100), OR private-repo CI exceeding 2,000 Linux min/mo (spin up a self-hosted runner on your Hetzner box for $0).

D7. Production Legal & Document AI Inference Routing

⚬ Options: (A) Single vendor direct API; (B) Thin Provider-Abstraction Layer routing stateless calls to AWS Bedrock EU (eu-central-1 Frankfurt) (claude-haiku-5-5 for extraction/routing + claude-sonnet-5-5 for synthesis) with Mistral EU (api.eu.mistral.ai, stateless ZDR) as EU-native secondary provider; (C) Self-hosted open-weight GPU server.
⚬ Recommendation: Option B. Avoids Anthropic's direct non-EU API and non-DPF status, avoids Mistral EU's lack of stateful/non-function tools by keeping orchestration in your own TypeScript code, avoids Gemini's 2x Dec 2026 / Jan 2027 price hikes, and shields you from Anthropic's Sep–Nov 2027 model retirements. Never enable Fable/Mythos 5.2 (30-day mandatory retention).
⚬ Cost: One-off €0; Monthly $5–$50 USD (usage-metered, <$0.025/legal query at 10k in / 1.5k out).
⚬ Effort: 2 days to build the provider router + prompt-caching + deterministic citation verifier.
⚬ Reversibility: Very High (stateless OpenAI/Anthropic-compatible adapter).
⚬ Revisit Trigger: Monthly LLM spend >$500 (negotiate committed throughput or evaluate dedicated EU GPU hosting for Mistral/open weights) OR model deprecation notice (60 days prior to Sep 2027).

D8. German Tax (ELSTER/DATEV), Bank Feeds (PSD2), and Payroll Boundaries

⚬ Options: (A) Build native ITSG payroll + direct bank scraping; (B) In-house E-Rechnung (EN 16931) + ELSTER ERiC (free) + DATEV CSV/EXTF first → DATEV Buchungsdatenservice + finAPI B2X gated on revenue; outsource statutory payroll execution via preparatory-payroll exports.
⚬ Recommendation: Option B. Never attempt ITSG/GKV payroll certification as a two-person team. Start accounting MVP with EN 16931 XML + camt.053/MT940 manual bank-statement import (€0/mo) and DATEV EXTF CSV export (€0/mo), then unlock finAPI Access B2X (€100/mo net for ≤200 users) and DATEV Marktplatz Buchungsdatenservice once ≥10 paying German SMEs cover the fixed cost.
⚬ Cost: Stage 0–1: €0; Stage 2 (at ≥10 paying SMEs): €100/mo finAPI B2X + DATEV onboarding engineering effort.
⚬ Effort: 2–3 weeks (E-Rechnung + camt.053 + DATEV EXTF); 3–4 weeks later for ERiC C-library wrapper + finAPI + DATEV Buchungsdatenservice.
⚬ Reversibility: Medium (switching PSD2 providers later takes 3–6 months of re-integration, so wrap finAPI behind a BankFeedAdapter).
⚬ Revisit Trigger: ≥10 paying German SMEs (activate finAPI B2X €100/mo & start DATEV Marktplatz application); ≥50 customers requesting native payroll (partner via API with an ITSG-certified payroll engine rather than self-certifying).

Phased Execution Roadmap (Aligned to Hard Statutory Dates)

Horizon	Concrete Actions	Target Cash Outlay
This Month (Nov–Dec 2026)	1. Rename "Smart Judge"; run DPMA/EUIPO search on "Roxira" and file DPMA mark (€290). 2. Standardize Mac/Linux HTTP proxy env + ~/.claude/settings.json + AGENTS.md + GitHub $0 hard budget cap. 3. Lock monorepo architecture (TS + Postgres + Better Auth MIT + EN 16931 BT/BG schema + Art. 50 UI banners + EU Data Act JSON/XML export endpoint). 4. Draft initial E&O/cyber insurance quote ahead of 9 Dec 2026 EU Product Liability Directive.	One-off: €290 DPMA. Monthly: $20–$54 USD (coding agents).
3 Months (by Feb 2027)	1. Ship Accounting/E-Rechnung (>€800k mandatory issuance live 1 Jan 2027) + CRM MVP on 1 Hetzner EU VPS (CPX22) + Hetzner Object Storage WORM (Object Lock 8-year bundles). 2. Confirm zero-fee tenant data export live before 12 Jan 2027 EU Data Act deadline. 3. Add camt.053 bank import + DATEV EXTF export + GoBD Verfahrensdokumentation draft. 4. Execute first automated Postgres restore drill to alternate Hetzner region.	Monthly: $54–$65 USD + €26.48–€30.48 EUR.
6 Months (by May 2027)	1. Onboard 5–10 paying German pilot SMEs; ship renamed Legal/Statute Navigator (Bedrock EU Haiku/Sonnet 5.5 + Mistral EU fallback + gesetze-im-internet.de / EUR-Lex deterministic citation gate). 2. If ≥10 SMEs live, activate finAPI B2X (€100/mo) behind BankFeedAdapter and initiate DATEV Marktplatz Buchungsdatenservice verification. 3. Add "Betriebsrat-safe" toggle (disable employee performance telemetry) for Mittelstand demos. 4. Integrate ELSTER ERiC C-library for UStVA submission.	Monthly: $75–$120 USD + €130–€145 EUR (funded by pilot MRR).
12 Months (by Nov 2027)	1. Launch Admin-only HR module (records/leave/preparatory payroll—zero profiling/scoring) and complete Article 6(4) memo + Article 49(2) EU database registration check before 2 Dec 2027 EU AI Act Annex III deadline. 2. Verify zero downloadable client/agent CRA exposure before 11 Dec 2027. 3. Prepare for 1 Jan 2028 SME e-invoicing wave (≤€800k turnover). 4. Migrate Claude 5.5/5.2 model IDs ahead of Anthropic's Sep–Nov 2027 retirement floor; upgrade VPS to CCX13 (€36.99+) if load warrants.	Monthly: $100–$200 USD + €150–€200 EUR (plus E&O/cyber insurance).

4. Open Questions Requiring a Human Expert (With Default Choices)

Each item separates the unresolved legal/tax/technical fact requiring qualified human sign-off from the low-risk engineering default to adopt immediately until you receive written advice.

1. RDG (§ 2 RDG) & StBerG Boundary for the Renamed Legal/Tax AI Assistant
  ⚬ Open fact / expert needed: A German Fachanwalt für IT-Recht must confirm where generative summarization of a tenant's contract against German statutes crosses from permissible legal information (BGH I ZR 113/20) into prohibited individualized legal/tax advice (§ 2 RDG / StBerG), especially for non-lawyer SME users.
  ⚬ Recommended default: Restrict outputs strictly to statute/clause retrieval, verbatim side-by-side comparison, and checklist flagging without legal conclusions, win-probability scores, or personalized tax-optimization advice, paired with an explicit non-advice disclaimer and mandatory human-lawyer review prompt.
2. Trademark Clearance for "Roxira" (Class 9/42) Against Lithuanian UAB "Roxira"
  ⚬ Open fact / expert needed: A German/EU trademark attorney (Markenanwalt) must run an official DPMA/EUIPO/WIPO similarity search in Nice Classes 9, 42, and 45 (13th Edition) and verify the NACE activities of UAB "Roxira" (307080991).
  ⚬ Recommended default: Keep "Roxira" as the working brand only until clearance passes (avoid printing collateral or buying multi-year brand assets), retire "Smart Judge" immediately, and file a €290 DPMA application as soon as the clearance search is clean.
3. EU AI Act Article 49(2) Registration Mechanics & Simplified Scope under Regulation (EU) 2026/1744
  ⚬ Open fact / expert needed: EU AI compliance counsel must check the final consolidated operative wording of Article 49(2) and Commission classification guidelines (post-May 2026 consultation) to confirm whether purely administrative HR/contract tools even trigger Annex III / Article 6(3) registration before 2 December 2027.
  ⚬ Recommended default: Design v1 HR and legal-lookup features strictly outside Annex III intended purposes altogether (no recruitment filtering, no worker evaluation, no profiling, no judicial/ADR decision support); if any borderline feature is added, budget for both an Article 6(4) memo and Article 49(2) EU database registration.
4. GoBD Audit-Proofing of Bundled WORM Archives & Verfahrensdokumentation
  ⚬ Open fact / expert needed: A German Steuerberater or Wirtschaftsprüfer (GoBD specialist) must confirm whether daily zipped EN 16931 XML bundles with SHA-256 manifests locked via Hetzner S3 Object Lock (8-year Retention) plus an append-only Postgres ledger satisfy Z1/Z2/Z3 audit access and GoBD immutability without needing a paid GoBD software attestation (IDW PS 880).
  ⚬ Recommended default: Store individual XMLs retrievably inside your database/search index for instant Z3 machine-readable export, and write immutable daily SHA-256-chained archives to Hetzner Object Storage with Object Lock enabled from tenant #1. Defer formal IDW PS 880 certification until enterprise revenue justifies it.
5. GDPR Transfer Impact Assessment (TIA) & US CLOUD Act Exposure on AWS Bedrock EU / Cloudflare R2 EU
  ⚬ Open fact / expert needed: A German Datenschutzbeauftragter (DPO) or GDPR lawyer must evaluate whether US-parented EU-region sub-processors (AWS Frankfurt for Bedrock Claude, Cloudflare R2 EU) remain acceptable for German accounting/HR/legal tenants given pending CJEU appeal C-703/25 P against DPF and US CLOUD Act concerns.
  ⚬ Recommended default: Keep all primary accounting, CRM, HR, and GoBD WORM data exclusively on German-owned Hetzner (zero US corporate nexus), use Mistral EU (api.eu.mistral.ai, French parent, ZDR) as the default "EU-Sovereign" AI mode, and offer AWS Bedrock EU (Claude) as an opt-in tenant setting covered by EU SCCs + documented TIA.
6. Strict Liability Coverage under EU Product Liability Directive (2024/2853) Starting 9 December 2026
  ⚬ Open fact / expert needed: A commercial IT insurance broker and liability lawyer must size Vermögensschadenhaftpflicht (IT E&O) and cyber insurance limits for a German SaaS selling accounting/tax and legal-research AI under no-fault strict liability.
  ⚬ Recommended default: Do not onboard paid external production tenants after 9 December 2026 without an active German IT Vermögensschadenhaftpflicht + cyber policy and an audited SaaS AGB / limitation-of-liability clause (to the extent permitted by B2B German law and 2024/2853).
7. Works Council (§ 87 Abs. 1 Nr. 6 BetrVG) Packaging for German Mittelstand Buyers
  ⚬ Open fact / expert needed: A German Fachanwalt für Arbeitsrecht should confirm what logging/telemetry must be configurable off to qualify for expedited Betriebsrat approval.
  ⚬ Recommended default: Build a tenant-level "No Employee Telemetry / Betriebsrat Mode" flag in v1 that suppresses per-user activity dashboards, keystroke/time-spent rankings, and individual AI usage analytics—costing ~1 day of engineering now versus months of blocked sales later.
