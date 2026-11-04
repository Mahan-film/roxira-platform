# ADR: Global core (country packs, calendars, multi-book)

Status: proposed, 2026-11-04. Stage 4 of `docs/strategy/IRAN_FIRST_ROADMAP_2026-10-31.md`. Issue #220.
Inputs: `docs/research/2026-10-31/07-global-core-country-packs-fa.md`, `08-international-market-entry-fa.md` (claims, not facts, until reproduced).
Owner: Mac lane (`mahan-films`). The laptop lane (accounting, invoicing, inventory, CRM, import, UI) is not edited by this work; where it must call the new code, a `claude-win` issue says how.

## Context

Roxira is Iran-first and stays so. Iran's rules are spread across the code today:

- chart templates in `modules/accounting/constants/iran-chart-template.ts`;
- statutory values in table `statutory_parameters`, which already has a `country` column (`modules/hr/statutory/`, constant `IRAN = 'IR'`);
- Moadian packet mapping and signing in `modules/tax_compliance/`;
- Jalali code in several places (`data_import/normaliser`, `hr/services/jalali-period`, `assistant/services/jalali-period`, `tax_compliance/utils/jalali-quarter.util`);
- fiscal years stored as Gregorian start and end dates (`fin_fiscal_years`), shown in Jalali by the UI.

Going global later (the owner picks the first foreign country; a Malaysian company runs it) must not mean forking the product or touching Iranian behaviour. We need a seam now, while only one country exists, and the seam must be provable by a second, fake country.

Non-goals: any foreign tax rate, chart or e-invoice format (owner decision pending; `XX` is a fake test pack only); multi-currency redesign (`modules/currency` exists); moving data between countries; changing any Iranian figure.

## Decision 1: country pack interface

A country pack is a plain, immutable object registered under an ISO 3166-1 alpha-2 code (`IR`, test-only `XX`). It holds no state and no database access. Everything that needs I/O is a small **port** the pack's adapter calls, injected by Nest when the pack is built.

```
CountryPack {
  country        // 'IR'
  name, status   // status: 'production' | 'test'
  locale         // language tags, digits, text direction, number/date style, currency code + minor units
  calendars      // primary calendar, default fiscal year spec (see Decision 2), weekend days
  chartTemplates // list of templates the accounting module may offer (neutral shape, no TypeORM entities)
  taxRules       // list of tax kinds and how to find their parameters (keys), never the values
  statutory      // StatutoryPort: values in force for (country, fiscal year, date), from the statutory store
  eInvoice       // optional EInvoiceAdapter: map, validate, (sign, submit are separate capabilities)
  payroll        // optional PayrollRulesAdapter: statutory rates for a period
  reportPack     // which statutory reports exist (id, title, period kind), so the UI can list them
}
```

Rules:

1. **Values never live in a pack.** Legal rates and limits stay in the statutory store, keyed by `country` and effective date. A pack only says which keys exist and calls the port. This keeps the existing rule "legal rates only in the statutory store".
2. **Capabilities are optional.** A country without e-invoicing or payroll rules leaves them `undefined`; callers must check `pack.eInvoice` and get a clear "not supported for country X" error, not a crash.
3. **Adapters, not rewrites.** The `IR` pack only wraps existing code (see Decision 4). A pack file may import from existing modules; existing modules must not import from a pack. The dependency points one way.
4. **Registry.** `CountryPackRegistry` offers `register`, `get(country)`, `has`, `list`. Lookup of an unknown country throws a typed error. Registering twice for the same code throws. Production packs register in the module factory; test packs register only inside specs or when `NODE_ENV !== 'production'`.
5. **Tenant link.** A tenant has a `country` (the `tenants` entity already carries country-like fields; the exact column and its migration belong to the first call-site issue, not to this ADR). Until then the default is `IR`, so nothing changes for existing tenants.
6. **No tenant data crosses the port.** Ports take ids and plain values and return plain values; tenant scoping stays in the existing repositories (AGENTS.md section 4).

Versioning: the pack object carries `version` (semver). Breaking interface changes bump the major; the registry refuses a pack whose `interfaceVersion` it does not know.

## Decision 2: calendar abstraction

One module, `modules/calendar`, owns conversion and period maths. Everything else calls it.

- Two calendars: `jalali` and `gregorian`. A date is `{calendar, year, month, day}`; persisted dates stay ISO text or SQL `date` in **Gregorian**, as `fin_fiscal_years` does today. The calendar is a presentation and period-definition choice, not a storage format. This keeps ledger events, joins and indexes calendar-free.
- All maths goes through an integer "epoch day" (days since 1970-01-01). No `Date`, no clock, no time zone: a civil date is a civil date. Time-zone handling stays at the edges (for Iran, `Asia/Tehran` when turning an instant into a date).
- Jalali leap years use the 33-year arithmetic rule `(25y + 11) mod 33 < 8`, verified against the platform's ICU data for every day from 1206 to 1500 (it first disagrees in 1502; the real calendar is astronomical). Years outside the verified range are refused, not guessed. When a longer range is needed, the table of leap years becomes data (a reviewed list from the official calendar centre) behind the same API.
- Fiscal years are described by a spec `{calendar, startMonth, startDay (1..28), labelBy: 'start'|'end'}`. Iran is `{jalali, 1, 1, start}`. A UK-style 6 April year, an Australian 1 July year named by its end year, and a Jalali year starting 1 Mehr are all expressible and tested. Periods are calendar months or quarters counted from the start. Dates written in the other calendar are converted before use.
- Boundaries of range: closed `[start, end]` plus `endExclusive`, so SQL `>= start AND < endExclusive` is always correct.
- Migration of the scattered Jalali helpers is **not** part of this change (they are in lanes owned by others and in production use). Each owner swaps its helper for `CalendarService` in its own issue (list at the end).

## Decision 3: multi-book (local book and IFRS book on the same ledger events)

Goal: one set of business events, more than one set of books (for example Iranian standards for tax and IFRS for a parent company), without copying transactions.

Design (to be built after the first foreign pack is chosen; recorded now so the pack interface leaves room):

1. **Events are book-free.** A journal entry keeps its current meaning: one balanced voucher. Today's single ledger is the **primary book** with `book = 'LOCAL'`.
2. **Book** is a first-class row: `{id, tenantId, key ('LOCAL' | 'IFRS' | ...), countryPackCountry, chartTemplateKey, baseCurrency, fiscalYearSpec, status}`. Every new table gets the tenant column and access checks in the NestJS repository layer, as AGENTS.md requires.
3. **Book lines, not book copies.** A secondary book is produced by *adjustment vouchers* (`book_id`, `source_voucher_id`, same fiscal period) plus an **account map** from the primary chart to the secondary chart (`account_map(book_id, from_account_id, to_account_id)`, effective-dated). A report for book B = primary lines mapped through the account map + adjustments of B. Nothing in the primary book changes; closing a year in one book does not close another.
4. **Default is one book.** A tenant without a second book behaves exactly as now. Report code takes an optional `book` argument that defaults to `LOCAL`.
5. **Rules for adjustments:** each adjustment voucher is balanced, points to its source, and is rejected if the source voucher is voided; reports must reconcile: `LOCAL total + sum(adjustments) = IFRS total` per account group, and this is a property test.
6. **Not chosen:** a full second ledger with double posting (drift, double storage), or a per-line "book flags" column on the existing table (touches the laptop lane's hot tables and blocks the first book).

Migration impact: additive tables and one optional nullable column set on the laptop-owned ledger tables, to be added by that lane's reviewed PR. This ADR makes no migration.

## Decision 4: Iran becomes the first pack without changing behaviour

The `IR` pack is built **only from adapters over existing code**:

| Pack part | Wraps | Change to the wrapped code |
|---|---|---|
| chartTemplates | `CHART_TEMPLATES` (`iran-trading`, `iran-service`), mapped to the neutral shape | none |
| statutory | `StatutoryService` / `StatutoryRepository` with `country = 'IR'` (constant `IRAN`) | none |
| payroll | `StatutoryService.ratesFor` (the payroll year rates) | none |
| eInvoice | `mapInvoiceToMoadianPacket` and `validatePacketAgainstPattern` | none |
| calendars | `IRAN_FISCAL_YEAR` (Jalali, 1 Farvardin) | none |
| locale | `fa-IR`, Persian digits for display, RTL, IRR (rial, 0 minor units) | none |
| reportPack | ids of the existing seasonal VAT, ledger export and statements | none |

Proof that behaviour is unchanged:

1. No existing code file is edited except the root `app.module.ts` (module imports); only the requirement rows change in docs.
2. Adapter tests call the pack and the wrapped function side by side and assert identical output (same chart accounts, same mapped packet, same statutory call arguments).
3. The existing suites of `accounting`, `tax_compliance` and `hr` stay untouched and green.
4. Nothing reads the pack in production code paths yet. Switching a caller to the pack is a separate, small, reviewed change per module.

The fake `XX` pack (test-only, `status: 'test'`) has its own made-up chart, a Gregorian 1 July year, a made-up statutory key set served from an in-memory port, no e-invoice adapter and no payroll adapter. Specs register it next to `IR`, resolve both by country and prove that nothing in the registry or the interface assumes Iran. It carries no real rule of any country.

## Consequences

- Positive: a foreign country becomes "add a pack, add statutory rows for its `country`, add its e-invoice adapter"; Iranian behaviour is untouched; the calendar has one tested implementation.
- Cost: one more indirection; two Jalali implementations coexist until the owners of the old helpers migrate.
- Risk: the Jalali range is 1206-1500 until a data table replaces the arithmetic rule. Documents beyond 1500 do not exist in practice for an accounting product today.
- Reversible: both new modules are additive; removing them removes nothing that existed.

## Call-site issues for the laptop lane (label `claude-win`)

To be opened after this lands, each small:

1. `accounting`: `fin_fiscal_years` creation and the year-close flow take the fiscal year spec and period list from `CalendarService`; chart template list comes from the pack of the tenant's country.
2. `invoicing`: read `pack.eInvoice` instead of importing Moadian directly when issuing for a tenant (domestic only; behaviour for IR identical).
3. `data_import`: replace the private `jalaliToGregorian` / `parseJalaliDate` with `CalendarService.convert` / `parse` (keep the Persian-digit normalisation in the normaliser).
4. `hr` and `assistant`: replace their `jalali-period` helpers with `CalendarService` (Mac lane; tracked here for completeness).
5. Frontend: date pickers and formatters take calendar from the tenant's pack locale.

## Decision the owner still has to make

Which country is the first foreign pack (stage 5)? Until the owner names one, no foreign tax rule, chart or e-invoice format is written, and Decision 3 (multi-book) stays a design, not code.
