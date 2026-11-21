# Deep-research prompts R34-R38 (two stages each)

R22-R33 are done (digests in `docs/strategy/research/`). These are the next gaps the digests exposed.
How to use: Gemini web, Deep Research mode. Send STAGE 1, then STAGE 2 in the same chat. Give both
outputs to the main hub with "register R<n>". Paste this context once at the top of every STAGE 1:

> Context: Roxira is a SaaS platform (accounting/tax, CRM, ERP, HR, AI legal assistant "Smart Judge",
> phone assistant) built by a two-person team using AI coding agents. Budget is minimal; open-source
> and free tiers first; spend only when it clearly pays. Next markets after the current default pack:
> Germany/EU first, then Malaysia and the Gulf. First customers pay by card online. Output language:
> English. Output: facts with primary-source URLs (official law text, regulator pages, provider terms)
> and the page date, kept separate from recommendations. Today is 2026-11-22. Do not invent figures,
> thresholds or dates: if you cannot find a primary source, write UNVERIFIED next to the claim and say
> what you tried. Prefer the official source over blogs; mark every secondary source as such.

Priority: R34 and R35 can block the first paying customer; R36 blocks first revenue; R37 and R38 shape the roadmap. If only two can be run now, run R34 and R35.

## STAGE 2 (identical for every R<n>)

STAGE 2 — Act now as a skeptical senior reviewer of the report you just wrote.
1. Re-check every number, date, threshold and legal claim against a primary source. Table: claim | source URL | source date | VERIFIED / CHANGED (correct value) / UNVERIFIABLE.
2. List what the report missed that would hurt us in 12–24 months (at least 10), each with why it matters.
3. Turn it into a DECISION PACK: options, recommendation, one-off and monthly cost, effort, reversibility, what to do this month / 3 / 6 / 12 months, revisit trigger.
4. List open questions that need a human expert, each with the default you would choose.
Keep facts and recommendations separate. Do not repeat the original report; only correct, extend and decide.

## R34 — LLM provider data terms and the legal basis for "free first, data improves the service"
STAGE 1:
1. Build a provider matrix for the model routes a SaaS can realistically use in 2026: Google Gemini Developer API (free and paid) and Vertex AI, OpenRouter (including its `:free` and data-collection settings), Groq, DeepSeek, Mistral (EU endpoint), Anthropic (direct and via cloud partners), OpenAI/Azure OpenAI, and one self-hosted open-weights option. For each: training on inputs (free vs paid), retention period, zero-data-retention availability, EU data residency, sub-processors, DPA and SCC availability, abuse-monitoring human review, and the exact terms page URL with its date.
2. GDPR: when a SaaS vendor is processor for customer data, can it also use that data to "run and improve the service" or train models? Cover Art. 28(3)(a), Art. 28(10), EDPB guidance (including opinion 28/2024 on AI models), and what wording a DPA needs. Give two or three compliant designs (for example: improvement only on de-identified or opt-in data; separate controller role with its own legal basis; no improvement use for professional-secrecy tenants) and the practical cost of each.
3. Transfers to non-EU model providers: status of the EU-US Data Privacy Framework and the pending appeal (cite the court register), when SCCs plus a transfer impact assessment are still required, what to do about providers in third countries without an adequacy decision, and sector rules for tax advisors (section 62a StBerG) and lawyers (section 203 StGB, section 43e BRAO) when using external AI.
4. Special-category and criminal-offence data in legal and tax queries (GDPR Art. 9 and 10): what a legal-assistant SaaS must do, and whether free-tier providers can ever be used for such queries.
5. Malaysia (PDPA 2010 as amended 2024: cross-border transfer rules, processor duties, breach notice) and the Gulf (Saudi PDPL, UAE PDPL and its executive regulations, and DIFC/ADGM regimes): the equivalent rules for sending customer data to a foreign LLM, with effective dates. Finish with a routing rule we can implement as config: which data classes may go to which provider tier, per market.

## R35 — Smart Judge regulatory scope (AI Act, legal-services rules, professional secrecy, liability)
STAGE 1:
1. EU AI Act (as amended by the Digital Omnibus, Regulation (EU) 2026/1744 — verify the number and status): is an AI legal-research assistant used by (a) lawyers, (b) consumers, (c) tax advisors, (d) courts or authorities high-risk under Annex III point 8 (administration of justice)? Quote Annex III, Art. 6(2)/(3) and the Commission guidelines on classification if published. Separate provider duties from deployer duties, and list the obligations that already apply to us regardless (Art. 4 AI literacy, Art. 50 transparency, general-purpose-model downstream duties), with dates.
2. Germany: the Legal Services Act (RDG) boundary between legal information and legal service for an AI tool sold to consumers and to small businesses; recent case law and bar or consumer-organisation actions against AI legal tools in 2025-2026; the disclaimer and product-scope design that stays inside the line (statute lookup and intake versus evaluating a concrete case).
3. Professional secrecy and law-firm customers: section 203 StGB, section 43e BRAO, and the rules on external IT service providers and AI for lawyers (bar association guidance). What contract and technical measures (no human review of logs, EU processing, confidentiality undertakings) make us usable by a small firm.
4. Malaysia and the Gulf: what each legal system says about unlicensed legal advice by software (Malaysia Legal Profession Act 1976; UAE, including DIFC/ADGM; Saudi Arabia, including the Ministry of Justice and the Saudi Bar rules), and whether a "legal information, not advice" model is accepted. Mark each answer by jurisdiction and cite the statute or regulator page.
5. Liability: EU Product Liability Directive (applies 9 Dec 2026; is software output that is wrong a defect?), contract liability caps under German standard-terms law (sections 307 and 309 BGB), and professional-indemnity or cyber insurance that actually covers AI errors (named insurers and typical conditions, price only if from a published source). End with a table: customer type x market -> allowed / allowed with conditions / not allowed, and the minimum product changes for each.

## R36 — First-revenue closure: card acceptance, EU B2B invoicing by a non-EU vendor, Gulf card rails
STAGE 1:
1. Acceptable-use and onboarding of Paddle, Stripe (direct and Managed Payments), Lemon Squeezy/Stripe, HitPay and one Gulf-capable gateway (for example Tap, PayTabs or HyperPay): are AI legal-assistant and accounting SaaS products allowed? Quote the restricted-business and legal-services clauses, list supported seller countries and settlement currencies, and the document checklist for a new seller with no operating history. Give the page URL and date for each.
2. EU VAT for a non-EU vendor selling B2B and B2C digital services: place of supply (VAT Directive Art. 44, 58), reverse charge (Art. 196), mandatory invoice content (Art. 226), whether a non-EU vendor must issue German structured e-invoices (XRechnung/ZUGFeRD) to German business customers from 1 Jan 2027 or 2028, and what changes when a merchant of record is the seller. Cite the Directive, UStG sections and the BMF letter.
3. Card-payment rules we must design for: Strong Customer Authentication under PSD2 (and the PSD3/PSR timeline), the EU withdrawal button, recurring-payment and free-trial rules, and card-network dispute monitoring thresholds (Visa VAMP, Mastercard GMAP) with the dates they apply.
4. Gulf card and wallet rails: mada, Apple Pay, local debit; what a foreign SaaS vendor needs to accept them; VAT on digital services for foreign suppliers in Saudi Arabia and the UAE, and whether e-invoicing applies to a foreign SaaS seller (ZATCA, UAE Ministry of Finance). Verify the Malaysian service-tax treatment of a foreign SaaS seller from the 2026 amendment text.
5. Decide per market with a table (Germany/EU, Malaysia, Gulf): recommended provider, fee structure from the published price page, payout rules, who is the seller of record, who issues the invoice, and the trigger to change after the first 50 customers. List every open item you could not verify.

## R37 — Competitor, pricing and channel teardown for Germany and the Gulf (Malaysia refresh)
STAGE 1:
1. Germany: the main small-business accounting and ERP products (for example lexoffice, sevDesk, Buchhaltungsbutler, DATEV Unternehmen online, Xero, Zoho Books, Odoo, others you find): current published price tiers (page URL and date), included users, e-invoice support, bank feeds, receipt capture, tax-advisor access, DATEV export, AI features. Present a feature-by-price table and mark which features are table stakes.
2. The tax-advisor channel in Germany: how many small businesses are served through a Steuerberater, how advisors pick tools, what the DATEV Marktplatz and DATEV interface programmes require and cost (certificate rules, partner tiers, fees), and how other vendors recruit advisors (revenue share, free advisor seats). State whether Roxira can start with the lighter interface route.
3. Gulf: Zoho Books, Qoyod, Wafeq, Odoo and local players: published prices, Arabic and right-to-left support, ZATCA/UAE e-invoicing readiness, VAT filing, payroll (WPS) support. Same table.
4. Malaysia refresh: Bukku, SQL, AutoCount, Sage, Xero, Zoho: current published prices and MyInvois readiness, to replace the unverified RM figures in our earlier report.
5. Customer-acquisition benchmarks for small-firm accounting SaaS: channels that work for a two-person team (comparison pages, free tools, advisor partners, marketplaces), published CAC, trial-to-paid and churn figures only from named sources, and what an AI-first product can claim that incumbents cannot yet. End with a ranked list of the three wedges and the features whose absence would lose deals in each market.

## R38 — Legal-corpus rights and the next jurisdiction for Smart Judge
STAGE 1:
1. Germany: official sources for federal statutes, regulations and case law (gesetze-im-internet.de, rechtsprechung-im-internet.de, the legal-information portals of the states, EUR-Lex and curia for EU law): reuse and re-publication terms, bulk or API access, update feeds, structure (XML, ELI), and licence of the text versus the database. Quote the terms with URL and date.
2. Malaysia and the Gulf: the same for Malaysia (AGC, court judgments, CommonLII), UAE (federal and emirate portals, DIFC and ADGM courts), and Saudi Arabia (Umm Al-Qura, Ministry of Justice and Board of Grievances portals). Cover language (Arabic, English), reuse permission, and whether machine ingestion and redistribution of excerpts in an AI answer are allowed.
3. Commercial legal databases and legal-AI competitors per market (for example Beck, juris, LexisNexis, vLex, Harvey and local entrants): what they cover, published prices, and where a free official-source product can still win.
4. Technical effort per jurisdiction: citation formats, amendment tracking (as-of dates), cross-references, translation or bilingual issues, and a rough corpus size in laws and decisions, so we can compare cost against the roughly 500-law target.
5. Recommend the order of jurisdictions for the corpus after the default pack, with a table (jurisdiction, source, licence, update feed, effort, legal risk, evaluation set we can build) and the permission requests we should send first.
