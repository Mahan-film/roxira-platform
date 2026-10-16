# Malaysian legislation reuse — research (2026-10-16, Claude Haiku 5.5 agent, reviewed by hub)

Provisional: several official pages were unreachable (403/404/500). Every claim carries its source.

## Findings
- **Official source:** Laws of Malaysia portal https://lom.agc.gov.my/ (Acts as PDFs, "Revised" reprints exist; no API or bulk download found). Footer: "Copyrights © 2026 All Rights Reserved by Attorney General's Chambers of Malaysia." The linked T&C page could not be retrieved; robots.txt returned HTTP 500.
- **Copyright Act 1987 (Act 332), s.3** excludes from "literary work" the "official texts of the Government or statutory bodies of a legislative or regulatory nature, or judicial decisions" (https://www.wipo.int/wipolex/en/legislation/details/22674). A reading of the definition, not a court ruling.
- Online updated texts are marked "NOT AN AUTHENTIC TEXT" unless reprinted under the Revision of Laws Act (WIPO Lex details/7603).
- **Singapore SSO** requires AGC permission but its FAQ grants reproduction with attribution and conditions (https://sso.agc.gov.sg/Terms-of-Use, https://sso.agc.gov.sg/FAQ); commercial scope unconfirmed.
- **Judgments:** free official search via https://www.malaysia.gov.my/en/digital-services/court-case-judgment-search (judgements.my, 2018); reuse terms not found.
- **Incumbents:** CLJ Law (pay-as-you-go RM70 first hour, RM35/hour after; annual per-user pricing not public: https://www.cljlaw.com/?page=cost), LexisNexis Malaysia, Lawnet (PNMB). Their headnotes/annotations are their own copyright: never ingest them.
- **Bar rules:** Malaysian Bar Circular 342/2023 on generative AI (outputs must be checked against legal databases; secondary source); 242/2025 unverified; Johor Bar Circular 75/2025 (https://johorebar.org.my/circular-no-75-2025-use-of-generative-ai-for-lawyers-9-feb-2026/).

## Pilot Act list (solo / small-firm practice)
Contracts Act 1950 (136), Specific Relief Act 1950 (137), Limitation Act 1953 (254), Civil Law Act 1956 (67),
Evidence Act 1950 (56), Courts of Judicature Act 1964 (91), Employment Act 1955 (265), Industrial Relations
Act 1967 (177), Partnership Act 1961 (135), Law Reform (Marriage and Divorce) Act 1976 (164), Islamic Family Law
(Federal Territories) Act 1984 (303), Probate and Administration Act 1959 (97), Wills Act 1959 (346), Strata
Titles Act 1985 (318), Strata Management Act 2013 (757), National Land Code (828), Housing Development (Control
and Licensing) Act 1966 (118), Control of Rent Act 1966 (363), Hire-Purchase Act 1967 (212), Companies Act 2016
(777). Also: Penal Code (574), Criminal Procedure Code (593), Bankruptcy/Insolvency Act 1967 (360), Stamp Act
1949 (378), Trustee Act 1949 (208) — numbers to confirm on the official portal.

## Verdict and gate
Building on official Malaysian legislation looks legally plausible (s.3 exclusion) but is **not confirmed**:
1. Retrieve and archive the AGC T&C page (date + wording).
2. Ask the AGC in writing for permission to store, reuse and sell the Acts with attribution
   (draft: `docs/owner/AGC_PERMISSION_REQUEST_DRAFT.md`).
3. Use reprinted/revised official text with a currency disclaimer; never present "updated text" as authentic.
4. Never use CLJ/LexisNexis/Lawnet editorial material.
5. Confirm the judgments portal's reuse terms before ingesting judgments.
6. Confirm the current Bar circulars and any court AI practice directions from primary sources.
Engineering may build the pipeline on a few Acts for **internal evaluation only** until (2) is answered.
