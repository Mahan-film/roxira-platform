# Malaysian Federal Legislation Portal (AGC): reuse and licence terms (2026-10-22)

Scope: can Roxira (through the Malaysian company, Track G) store, index and serve the text of Malaysian
federal Acts from the Attorney General's Chambers (AGC) portal `https://lom.agc.gov.my/` inside a **paid**
research tool for lawyers? Follows up `2026-10-16_malaysia_legislation_reuse.md` (gate items 1 and 2) and
`docs/strategy/MASTER_PLAN_2026-10-16.md` §5 rank 1 (G2).

## How this was researched, and its limits

- The research container's egress proxy **refused** connections to `lom.agc.gov.my`, `www.agc.gov.my`,
  `www.wipo.int`, `en.wikisource.org` and the university mirrors of the Copyright Act (HTTP 403 on
  CONNECT, 2026-10-22). Nothing was downloaded from the portal.
- The quotes below therefore come from **search-engine extracts** of the named pages (web search,
  2026-10-22), not from a page this session loaded itself. Each quote names the URL it is attributed to.
  Treat them as strong leads, not as archived evidence.
- Gate item 1 of the 2026-10-16 note ("retrieve and archive the AGC T&C page") is **still open**: someone
  with a normal browser must save `https://lom.agc.gov.my/tnc.php` (PDF print + date) into
  `docs/research/global/evidence/` before we rely on it.

## What the AGC portal says (`https://lom.agc.gov.my/tnc.php`, "Malaysia Federal Legislation")

| Topic | Quote (search extract) |
| --- | --- |
| Copyright notice | "Copyright 2023 by Attorney General's Chambers, Malaysia, all rights reserved" |
| Status of the LOM series | "The Laws of Malaysia series (LOM) is a compilation and reprint of laws published in volume form pursuant to section 14A of the Revision of Laws Act 1968. It is the only official and authentic publication of the laws of Malaysia." |
| Online text is not the reprint | "These online versions are not the reprinted version made pursuant to Section 14 of the Revision of Laws Act 1968 [Act 1]. Both printed and online versions reprint of the Laws of Malaysia Series were updated up to the date mentioned on the front page of each Laws ..." (extract truncated) |
| User responsibility | "Users of this portal shall be solely responsible for any information retrieved, stored or transmitted through or from this portal." |
| Liability (paraphrase in the extract, not verbatim) | AGC and the Government of Malaysia accept no responsibility for damage arising from use of or reliance on the portal's information, for loss of information when access is interrupted, suspended or terminated, or for failures caused by events outside their control. |

Not found in any extract: a licence grant, an open-data licence (e.g. CC-BY), a "reproduction permitted with
attribution" clause like Singapore's, or an explicit ban on commercial reuse or automated download.
A third-party repository that converted the portal's Acts to Markdown reports the portal says federal
legislation "can be accessed and downloaded at no charge", and that robots.txt "returns an HTTP 500 (none
usable)" (`https://github.com/LawCodex/my`, README, retrieved 2026-10-12/13 by its author). That repository
states no licence for the texts.

Each online Act PDF carries the cover line "LAWS OF MALAYSIA ONLINE VERSION OF UPDATED TEXT OF REPRINT"
(e.g. Act 332 as hosted by MyIPO, `https://www.myipo.gov.my/wp-content/uploads/2025/09/Copyright-Act-1987-Act-332.pdf`)
and the updated texts are stated to be "NOT AN AUTHENTIC TEXT" unless reprinted by the Commissioner of Law
Revision (WIPO Lex `https://www.wipo.int/wipolex/en/text/597931`, per search extract).

## What the Copyright Act 1987 [Act 332] says

| Provision | Quote (search extract) | Effect for us |
| --- | --- | --- |
| s.3 "literary work" (as amended by Act A775/1990 and Act A1420/2012) | "... but does not include official texts of the Government or statutory bodies of a legislative or regulatory nature, or judicial decisions, or political speeches and political debates, or speeches delivered in the course of legal proceedings, and the official translation thereof" | The **text of an Act** is not a protected literary work. |
| s.11(1) Government works | "Copyright shall subsist in every work which is eligible for copyright and which is made by or under the direction or control of the Government and such Government organizations or international bodies as the Minister may by order prescribe." | Government copyright exists only for works that are "eligible for copyright". Because s.3 excludes legislative texts, s.11 should not catch the Act text itself. It **can** catch AGC's own additions: compilation/arrangement, editorial notes, layout, the portal's database and software. |
| s.11(3) | Copyright under s.11 "shall vest initially in the Government, Government organization or international body and not in the author." | Owner of any protected AGC material is the Government. |

Sources: `https://www.wipo.int/wipolex/en/legislation/details/3113` (Act 332 as amended up to Act 1082),
`https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20332%20-%20Copyright%20Act%201987%20Cetakan%20Semula%202013.pdf`
(official 2013 reprint), `https://www.commonlii.org/my/legis/consol_act/ca1987133/`. The s.3 wording was
combined from two extracts (1990 base text + 2012 insertion); confirm against the current reprint.

## Verdict on commercial reuse

**Probably lawful for the bare statutory text, not confirmed, and not licensed.**

1. **The words of the Acts**: s.3 of the Copyright Act 1987 excludes "official texts of the Government ... of
   a legislative or regulatory nature" from literary works. On that reading nobody (including AGC) holds
   copyright in the wording of an Act, so storing, indexing and quoting it in a paid tool does not infringe.
   This is our reading of the statute, not a court ruling or legal advice.
2. **What AGC can still claim**: the portal's "all rights reserved" notice, the compilation, the layout, the
   editorial apparatus of the reprints, and the portal database. Copying whole PDFs or mirroring the site
   goes beyond "the text of the law" and is where risk sits. Bulk automated download is not addressed by
   any term we found and robots.txt is broken; that is not permission.
3. **Authenticity**: AGC says the online versions are *not* the authentic reprint. Any product must say so
   on every answer ("non-authoritative online text, as at <date>; check the official reprint/Gazette").
4. **Liability**: AGC disclaims all responsibility; currency and errors are ours. Lawyers must verify.

### Decision for engineering (applies until the owner records a different decision)

| Allowed now | Not allowed until gate below is closed |
| --- | --- |
| Build and unit-test the ingestion adapter on **hand-made fixtures** | Bulk or scripted download from `lom.agc.gov.my` |
| Manually download a **handful** of Act PDFs (owner, normal browser) for **internal evaluation only** | Serving Malaysian Act text to any external user, paid or free |
| Landing page + waitlist that makes no claim about coverage beyond "pilot" | Claims such as "official", "authoritative" or "complete" |
| | Copying AGC editorial notes/footnotes, CLJ, LexisNexis or Lawnet material (never) |

### Gate to close before a public pilot

1. Archive `https://lom.agc.gov.my/tnc.php` and the portal footer (browser save + date) in
   `docs/research/global/evidence/`.
2. Send the written permission request to AGC (draft referenced in the 2026-10-16 note:
   `docs/owner/AGC_PERMISSION_REQUEST_DRAFT.md`), asking explicitly for: storage, indexing, quoting
   sections in a commercial service, automated retrieval at a polite rate, and the attribution wording they
   want. Record the reply.
3. Short written opinion from a Malaysian advocate & solicitor on points 1–2 of the verdict (one-off fee;
   the same lawyer can be a pilot user).
4. If AGC does not answer within ~30 days: owner decides, with the lawyer's opinion, whether to launch on
   the s.3 reading, limited to section text with attribution and the "not authentic" notice, and with
   manual (not crawled) acquisition of the 20 pilot Acts.

## Pilot list (20 Acts)

Machine-readable copy with status `proposed`: `config/legal_allowlist_my.json` (used with
`scripts/legal/ingest_pipeline.py validate --allowlist config/legal_allowlist_my.json --allow-proposed`).
Chosen for the daily work of solo and small-firm practitioners (contracts and civil litigation, employment,
company secretarial, conveyancing and strata, family and probate, debt recovery, data protection).
Act numbers are from memory and secondary sources; confirm each on the portal when the PDF is obtained.

| # | Act | No. | Practice area |
| --- | --- | --- | --- |
| 1 | Contracts Act 1950 | Act 136 | Contracts |
| 2 | Specific Relief Act 1950 | Act 137 | Remedies |
| 3 | Limitation Act 1953 | Act 254 | Civil litigation |
| 4 | Civil Law Act 1956 | Act 67 | Civil / torts |
| 5 | Evidence Act 1950 | Act 56 | Litigation |
| 6 | Courts of Judicature Act 1964 | Act 91 | Procedure, appeals |
| 7 | Subordinate Courts Act 1948 | Act 92 | Procedure, jurisdiction |
| 8 | Employment Act 1955 | Act 265 | Employment |
| 9 | Industrial Relations Act 1967 | Act 177 | Employment disputes |
| 10 | Companies Act 2016 | Act 777 | Corporate |
| 11 | Personal Data Protection Act 2010 | Act 709 | Data protection |
| 12 | Consumer Protection Act 1999 | Act 599 | Consumer |
| 13 | Hire-Purchase Act 1967 | Act 212 | Consumer credit |
| 14 | Insolvency Act 1967 (formerly Bankruptcy Act) | Act 360 | Debt recovery |
| 15 | National Land Code (Revised 2020) | Act 828 | Land, conveyancing |
| 16 | Housing Development (Control and Licensing) Act 1966 | Act 118 | Property |
| 17 | Strata Management Act 2013 | Act 757 | Strata |
| 18 | Law Reform (Marriage and Divorce) Act 1976 | Act 164 | Family (civil) |
| 19 | Probate and Administration Act 1959 | Act 97 | Estates |
| 20 | Distribution Act 1958 | Act 300 | Estates (intestacy) |

Next candidates: Penal Code (Act 574), Criminal Procedure Code (Act 593), Partnership Act 1961 (Act 135),
Sale of Goods Act 1957 (Act 382), Stamp Act 1949 (Act 378), Strata Titles Act 1985 (Act 318),
Arbitration Act 2005 (Act 646). Rules of Court 2012 is subsidiary legislation (P.U.(A) 205/2012) and needs
a separate check.

## Sources

- AGC terms page: https://lom.agc.gov.my/tnc.php (search extracts, 2026-10-22; not loaded directly)
- AGC portal: https://lom.agc.gov.my/
- Copyright Act 1987, official reprint 2013: https://lom.agc.gov.my/ilims/upload/portal/akta/LOM/EN/Act%20332%20-%20Copyright%20Act%201987%20Cetakan%20Semula%202013.pdf
- Copyright Act 1987 on WIPO Lex: https://www.wipo.int/wipolex/en/legislation/details/3113 and https://www.wipo.int/wipolex/en/text/597931
- CommonLII consolidation: https://www.commonlii.org/my/legis/consol_act/ca1987133/
- MyIPO copy of Act 332 (online updated text): https://www.myipo.gov.my/wp-content/uploads/2025/09/Copyright-Act-1987-Act-332.pdf
- Third-party conversion and its notes on the portal: https://github.com/LawCodex/my
- Singapore comparison (explicit reuse clause): https://sso.agc.gov.sg/Terms-of-Use
- Earlier note: `docs/research/global/2026-10-16_malaysia_legislation_reuse.md`
