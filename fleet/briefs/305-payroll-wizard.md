# Brief #305: payroll wizard steps and حقوق و دستمزد grouping (frontend only)

Worktree: /home/mahan/Developer/roxira-wt/305-design-payroll-wizard-and-grouping
Frontend root: output_apps/enterprise_hub/frontend (paths below are relative to it).
Do NOT commit. Do NOT touch package.json, lockfiles, app-shell.tsx, app.module.ts, permission-matrix.snapshot.json, migrations, .github, modules/posting_rules, modules/treasury, or any backend file. No new npm dependency.

## Goal (from #305 and docs/design/DESIGN_AUDIT_2026-11.md section 12)
1. The menu group that holds payroll is «حقوق و دستمزد». The tax item moves out to its own group «مالیات».
2. The payroll page `src/app/app/hr/payroll/page.tsx` (580 lines) gets a four-step header: ماه → بازبینی → فیش‌ها → ثبت سند. Statutory files are outputs of the last step, so the final step links to the statutory page.

## Part A: menu (`src/lib/nav-menu.ts`)
Current group at about line 142: `id: "payroll-tax"`, `label: "حقوق و دستمزد و مالیات"`, items: `/app/tax` (مالیات و مودیان), `/app/hr` (کارکنان), `/app/hr/payroll` (حقوق و دستمزد ماهانه), `/app/hr/statutory` (پارامترهای قانونی).

Change it to exactly:
- group `id: "payroll"`, `label: "حقوق و دستمزد"`, icon `"UsersRound"`, items in this order:
  - `/app/hr` label `کارکنان`, icon `UsersRound`, module `hr`, keep its `keywords` array.
  - `/app/hr/payroll` label `حقوق ماهانه`, icon `Calculator`, module `hr`.
  - `/app/hr/statutory` label `بیمه و مالیات حقوق`, icon `ClipboardList`, module `hr`.
- new group directly after it: `id: "tax"`, `label: "مالیات"`, icon `"Landmark"`, items: `/app/tax` label `مالیات و مودیان`, icon `Landmark`, module `tax`.
- Keep every other group and item untouched. Keep the object shape exactly as the file already uses (look at the lines around it and copy the style).

Test update: `src/lib/nav-menu.test.ts` has a list of group ids at about line 36-46 (it contains `"payroll-tax"`) and a test `group labels match the brief exactly` (about line 48). Replace `"payroll-tax"` with `"payroll", "tax"` in that id list, and update the expected labels in the second test to the new labels above. Fix only what these two changes break. Do not change other expectations.

## Part B: wizard steps (pure logic first)
Create `src/lib/payroll-steps.ts`:

```ts
export type PayrollStepKey = "month" | "review" | "payslips" | "posting";
export interface PayrollStepView { key: PayrollStepKey; label: string; state: "done" | "current" | "todo" }
export interface PayrollStepsView { current: 0 | 1 | 2 | 3; steps: PayrollStepView[] }
export function payrollSteps(run: { status: "DRAFT" | "POSTED" } | null, hasPayslips: boolean): PayrollStepsView
```

Rules (exact):
- run is null → current 0 (month).
- run.status "DRAFT" and hasPayslips false → current 1 (review).
- run.status "DRAFT" and hasPayslips true → current 2 (payslips).
- run.status "POSTED" → current 3 (posting). Steps 0 to 2 are "done", step 3 is "current".
- Steps before current are "done", current is "current", after are "todo".
- Labels exactly: `ماه`, `بازبینی`, `فیش‌ها`, `ثبت سند`. Keys in the same order.

Type `PayrollRunStatus` is `"DRAFT" | "POSTED"` in `src/types/hr.ts`; you may import it instead of writing the literal union.

Test: `src/lib/payroll-steps.test.ts` with `node:test` and `node:assert/strict`. Write the expected values by hand from the rules above: null → current 0; DRAFT + false → 1; DRAFT + true → 2; POSTED → 3; and for POSTED assert steps states are ["done","done","done","current"]. Run with `npx --yes tsx --test src/lib/payroll-steps.test.ts src/lib/nav-menu.test.ts` and both must pass.

## Part C: stepper component
Create `src/components/hr/payroll-steps.tsx` exporting `PayrollStepper({ view }: { view: PayrollStepsView })`:
- Render `<nav aria-label="مراحل حقوق و دستمزد"><ol className="flex flex-wrap gap-2">…</ol></nav>`.
- Each item is `<li>` with the label; the current item has `aria-current="step"` and a stronger style (`font-semibold`, border `border-primary`); done items show a check mark from `lucide-react` (`Check`), todo items are `text-muted-foreground`.
- Use logical CSS only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`). Do not use `left-`, `right-`, `ml-`, `mr-`.
- Works at 375 px: `flex-wrap`, no fixed widths.

## Part D: use it on the payroll page
In `src/app/app/hr/payroll/page.tsx`:
- Import `payrollSteps` from `@/lib/payroll-steps` and `PayrollStepper` from `@/components/hr/payroll-steps`.
- Put `<PayrollStepper view={payrollSteps(run, (run?.employeeCount ?? 0) > 0)} />` directly under the page header. `run` is the existing state variable (type `PayrollRun | null`). Pass `run` as is; its `status` field is `DRAFT` or `POSTED`.
- Add a final card, shown only when `run?.status === "POSTED"`, with the title «فایل‌های قانونی» and text «فایل‌های بیمه و مالیات حقوق این ماه از صفحه پارامترهای قانونی ساخته می‌شوند.» and a `Link` (from `next/link`) with text «رفتن به بیمه و مالیات حقوق» to `/app/hr/statutory`. Use the existing `Card`, `CardHeader`, `CardTitle`, `CardContent` from `@/components/ui/card`.
- Do not change any other behaviour, request, or state in this page.

## Persian and format rules
- Dates stay Jalali (the page already uses `formatJalaliDateTime` and `periodLabel`). Do not add new date formatting.
- Counts use `formatNumber` from `@/lib/fa-format`. Money uses `formatMoneyRial`. Do not write ASCII digits in visible text.
- No fake data. The stepper uses only the run state the page already has.

## Do not
- Do not change `src/lib/api/hr-client.ts` or any API call.
- Do not remove the existing InsuranceListCard or PayslipView.
- Do not add tabs or hash links (`#vat`, `#moadian`); that is out of scope.
- Do not touch the dashboard.

## Final checks the builder must run
- `npx --yes tsx --test src/lib/payroll-steps.test.ts src/lib/nav-menu.test.ts` passes.
- `grep -n "payroll-tax\|حقوق و دستمزد و مالیات" src/lib/nav-menu.ts src/lib/nav-menu.test.ts` returns nothing.
- `grep -n "left-\|right-\|ml-\|mr-" src/components/hr/payroll-steps.tsx` returns nothing.
