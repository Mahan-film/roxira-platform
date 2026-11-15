# Research R1 — product, UX and frontend architecture (digest)

Source: the owner's deep-research run of prompt 1 (`deep_research_prompts.md`), received 2026-11-15. This is the coordinator's digest and the decisions taken from it. The full report stays with the owner.

**Caution for agents:** the report quotes library versions and release dates that nobody here has checked. Before adding or upgrading a package, run `npm view <pkg> version` and use what npm says. Never downgrade a package that is already in `package.json` (for example, `@base-ui/react` is already `^1.9.0`, above the report's "1.0.0").

## What the market did (2025–2026)
- The large SMB suites replaced long module menus with **6–8 job hubs**, a universal **+Create** button, and an **AI feed** on the home page. Users review the AI's work there instead of typing into an empty chat.
- AI that works in accounting:
  - automates high-confidence routine entries;
  - shows *why* it matched something (rule, open document, tenant history, global pattern);
  - offers one-click undo;
  - leaves ambiguous items to a human: split payments, FX receipts, contra entries, multi-account lines.
- Users trust numbers they can click through to the source transaction. Prose summaries without drill-down lose trust.
- Messaging apps (receipt photo, "bill X to Y") are a primary input channel in growth markets.
- The wedge against global incumbents in new countries is **native local compliance**: e-invoicing, tax and payroll inside the core flow, not as a third-party add-on.

## Decisions (adopted)
1. **IA: 7 hubs plus header and footer.** This replaces the 8/10 rows in `PRODUCT_RESET_2026-11-15.md` §3.
   - **Header:**
     - Ask / Ctrl K: deterministic page and record search in the top half; "ask the assistant" on Enter;
     - +Create;
     - branch switcher;
     - notifications.
   - **Hubs:**
     1. Home (KPIs, AI and alerts feed, assistant input);
     2. Sales (quotes, invoices, POS, customers/CRM, e-invoice status, returns);
     3. Purchases & stock (receipt inbox, bills, suppliers, expenses, items, warehouses, stock documents, production/BOM);
     4. Money (banks, reconciliation, cash boxes, petty cash, cheques, damages calculator);
     5. People (employees, attendance, leave, payroll, statutory);
     6. Accounting & tax (vouchers, chart, fiscal years, recurring, fixed assets, dimensions, contracting, tax filings, e-books);
     7. Reports (standard, builder, consolidated, cost centres, budget vs actual, legal research).
   - **Footer:** Settings, one page with tabs. Import and migration lives here and in every empty state.
2. **Onboarding asks three questions** that drive module visibility.
   - The questions: business type (services / shop or restaurant / trading / manufacturing), number of branches, and simple vs accountant mode.
   - Hidden modules stay reachable from Ctrl K and Settings.
   - In simple mode, raw journals, the chart of accounts and fiscal years go under an "advanced" group.
3. **Ask first, click second.**
   - Every number or entity in an assistant answer carries a citation token `[[type:id|label]]`, which the UI renders as a chip that opens the record.
   - An answer with an uncited number fails the validator.
   - Ledger answers and external/legal answers render in visually separate blocks.
4. **AI never posts.**
   - AI-created records are `DRAFT` or `STAGED` only.
   - Posting and sending to a government API need a human click or a deterministic user-made rule.
   - Splits, FX and contra always go to the review feed.
   - Arithmetic is done by SQL or decimal-safe services, never by the model.
5. **No per-action AI credits.** Core extraction and chat are in the base plan with fair-use limits; pricing is the owner's call.
6. **Design system: one semantic token set.**
   - Today there are three parallel families (`--ap-*`, `--gh-*`, `--glass-*`) plus about 2,500 raw palette classes in the frontend.
   - Target: semantic tokens only (`primary`, `muted`, `success`, `warning`, `info`, `destructive`, plus an `--ai-surface` tint for AI drafts), plus `tabular-nums` on all amounts.
   - A lint ratchet keeps raw palette classes and physical-direction classes out of everything except `components/ui`.
7. **Logical CSS only** (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end`), so one codebase serves RTL and LTR. Wrap IDs, phone numbers and formulas in `dir="ltr"` with bidi isolation.
8. **Quality gates in CI:**
   - Playwright smoke for every page;
   - axe WCAG 2.x A/AA with a per-route baseline that may only go down;
   - screenshots in light and dark.
9. **i18n:**
   - next-intl with namespace catalogues (`messages/<locale>/<namespace>.json`);
   - a deterministic codemod extracts the Persian literals: 445 files, about 8,300 lines;
   - machine translation of new keys uses a fixed accounting glossary and is marked `ai_draft` until a human approves it.
   - Verify the next-intl extraction API in the installed version before relying on it.
10. **Dates:**
    - store ISO dates and `timestamptz`;
    - calendar math goes through one library (`@internationalized/date` or the existing `CalendarService`), with no hand-rolled Jalali code in new work;
    - fiscal periods are stored as explicit start and end dates.
11. **Tables:** one shared `DataTable` on TanStack Table, with virtualisation, sorting and filtering, column visibility, a selection-sum footer and CSV export. It replaces the ad-hoc tables in about 96 files.
12. **Migration pipeline:** keep the existing wizard (dry run, review, reconciliation). Add:
    - a `migration_batch_id` on committed rows;
    - a trial-balance gate (debits = credits, or post to suspense with a click);
    - rollback of a batch within 24 h if nothing from it was sent to a tax authority.

## Deferred
- **Native mobile app** (Expo) for POS hardware, camera receipts and attendance with biometrics and geofencing. Phase 5. Until then: responsive web and PWA.
- **Messaging-bot input** (receipt photo or text, then a draft): after the home feed exists.
- **Bank-reconciliation "matched by" column with one-click undo:** after the branch and home work.

## Mapping to waves
WAVE 14 carries 1, 2, 3 (tools and citation chips), 6, 7, 8, the i18n infrastructure (9), 11, branch dimension, daily attendance and the home hub. The extraction runs as batch PRs per slice once the infrastructure merges.
