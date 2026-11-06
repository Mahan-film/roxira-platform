PR #344. Your earlier attempt was rejected: it broke live unit switching, removed a guard, added a duplicate cash-flow total and imported a name that is not exported. Make ONLY these edits.

File 1: output_apps/enterprise_hub/frontend/src/lib/fa-format.ts — add `export` to `const UNIT_SUFFIX`. Nothing else.

File 2: output_apps/enterprise_hub/frontend/src/components/accounting/reports/report-views.tsx
- Keep `useMoneyUnit`. Do NOT use readMoneyUnit (it does not re-render when the viewer switches unit).
- In each exported view that shows amounts, call `const [unit] = useMoneyUnit();` once and pass `unit` as a prop to StatementTable, Section, Row and Amount. Type the prop as `MoneyUnit` imported with `import type` from "@/lib/fa-format". No `as` casts, no `string` type.
- `Amount` no longer calls the hook. `Row` keeps `amount === undefined ? "" : <Amount .../>` and the `AMOUNT` class constant exactly.
- StatementTable header becomes: مبلغ ({UNIT_SUFFIX[unit]}) so rial still reads "مبلغ (ریال)". Any other hard-coded "(ریال)" amount header in this file gets the same treatment.
- Do not add, remove or reorder any row, section or total prop. `<Section section={report.operating} />` stays without a total.
- Do not create any other file, including tests or helper scripts.

Acceptance: `git diff --stat` lists exactly these 2 files, and `grep -n "readMoneyUnit" report-views.tsx` finds nothing. Do not commit or push. State honestly if you could not run tsc.

Status: File 1 is already done in the worktree. Do File 2 only.
