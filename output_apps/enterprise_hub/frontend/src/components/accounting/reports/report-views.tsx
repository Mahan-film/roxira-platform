"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatJalaliDate, formatReportMoney } from "@/lib/fa-format";
import { useMoneyUnit } from "@/lib/money-unit";
import {
  TRIAL_BALANCE_GROUP_LABELS,
  type BalanceSheetReport,
  type CashFlowReport,
  type EquityChangesReport,
  type IncomeStatementReport,
  type InferredAccount,
  type LedgerReport,
  type Money,
  type ReconciliationCheck,
  type StatementSection,
  type TrialBalanceAmounts,
  type TrialBalanceReport,
} from "@/types/accounting-reports";

/** A report amount in the unit the viewer chose (exact; negatives in brackets). */
function Amount({ value }: { value: number | string | null | undefined }) {
  const [unit] = useMoneyUnit();
  return <>{formatReportMoney(value, unit)}</>;
}

const AMOUNT = "text-left tabular-nums whitespace-nowrap";

function Row({ title, amount, strong }: { title: string; amount?: Money; strong?: boolean }) {
  return (
    <TableRow className={strong ? "font-bold" : undefined}>
      <TableCell className="whitespace-normal">{title}</TableCell>
      <TableCell className={AMOUNT}>{amount === undefined ? "" : <Amount value={amount} />}</TableCell>
    </TableRow>
  );
}

function Section({ section, total }: { section: StatementSection; total?: string }) {
  if (section.lines.length === 0) return null;
  return (
    <>
      <Row title={section.title} strong />
      {section.lines.map((line) => (
        <Row key={line.line} title={line.title} amount={line.amount} />
      ))}
      {total && <Row title={total} amount={section.total} strong />}
    </>
  );
}

function StatementTable({ children }: { children: React.ReactNode }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>شرح</TableHead>
          <TableHead className="text-left">مبلغ (ریال)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  );
}

/** Reconciliation result and any accounts classified from their name. */
export function ReportNotes({
  checks,
  inferred,
}: {
  checks?: ReconciliationCheck[];
  inferred?: InferredAccount[];
}) {
  const failed = checks?.filter((check) => !check.ok) ?? [];
  return (
    <div className="grid gap-1 px-4 py-3 text-xs text-muted-foreground">
      {checks && failed.length === 0 && <p>با تراز آزمایشی می‌خواند.</p>}
      {failed.map((check) => (
        <p key={check.key} role="alert" className="font-medium text-destructive">
          نمی‌خواند: {check.title}
        </p>
      ))}
      {inferred && inferred.length > 0 && (
        <p>
          ردیف گزارش {inferred.length} حساب از روی نام و نوع آن تعیین شده است:{" "}
          {inferred.slice(0, 8).map((account) => account.code).join("، ")}
          {inferred.length > 8 ? "، ..." : ""}
        </p>
      )}
    </div>
  );
}

export function BalanceSheetView({ report }: { report: BalanceSheetReport }) {
  return (
    <>
      <StatementTable>
        <Section section={report.currentAssets} total="جمع دارایی‌های جاری" />
        <Section section={report.nonCurrentAssets} total="جمع دارایی‌های غیرجاری" />
        <Row title="جمع دارایی‌ها" amount={report.totalAssets} strong />
        <Section section={report.currentLiabilities} total="جمع بدهی‌های جاری" />
        <Section section={report.nonCurrentLiabilities} total="جمع بدهی‌های غیرجاری" />
        <Row title="جمع بدهی‌ها" amount={report.totalLiabilities} strong />
        <Section section={report.equity} total="جمع حقوق مالکانه" />
        <Row title="جمع بدهی‌ها و حقوق مالکانه" amount={report.totalLiabilitiesAndEquity} strong />
      </StatementTable>
      <ReportNotes checks={report.checks} inferred={report.inferredAccounts} />
    </>
  );
}

export function IncomeStatementView({ report }: { report: IncomeStatementReport }) {
  const lines = (section: StatementSection) =>
    section.lines.map((line) => <Row key={line.line} title={line.title} amount={line.amount} />);
  return (
    <>
      <StatementTable>
        {lines(report.revenue)}
        {lines(report.costOfSales)}
        <Row title="سود (زیان) ناخالص" amount={report.grossProfit} strong />
        {lines(report.operatingExpenses)}
        {lines(report.otherOperatingIncome)}
        <Row title="سود (زیان) عملیاتی" amount={report.operatingProfit} strong />
        {lines(report.financeCosts)}
        {lines(report.nonOperating)}
        <Row title="سود (زیان) قبل از مالیات" amount={report.profitBeforeTax} strong />
        {lines(report.incomeTax)}
        <Row title="سود (زیان) خالص" amount={report.netProfit} strong />
      </StatementTable>
      <ReportNotes inferred={report.inferredAccounts} />
    </>
  );
}

export function CashFlowView({ report }: { report: CashFlowReport }) {
  return (
    <>
      <StatementTable>
        <Row title="سود (زیان) خالص" amount={report.netProfit} />
        <Section section={report.operating} />
        <Row title="جریان خالص نقد از فعالیت‌های عملیاتی" amount={report.operatingCash} strong />
        <Section section={report.investing} total="جریان خالص نقد از فعالیت‌های سرمایه‌گذاری" />
        <Section section={report.financing} total="جریان خالص نقد از فعالیت‌های تأمین مالی" />
        <Row title="خالص افزایش (کاهش) در موجودی نقد" amount={report.netChange} strong />
        <Row title="موجودی نقد ابتدای دوره" amount={report.openingCash} />
        <Row title="موجودی نقد پایان دوره" amount={report.closingCash} strong />
      </StatementTable>
      <ReportNotes checks={report.checks} inferred={report.inferredAccounts} />
    </>
  );
}

export function EquityChangesView({ report }: { report: EquityChangesReport }) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>شرح</TableHead>
            {["سرمایه", "اندوخته قانونی", "سایر اندوخته‌ها", "سود انباشته", "جمع کل"].map((title) => (
              <TableHead key={title} className="text-left">
                {title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row) => (
            <TableRow key={row.key} className={row.key === "closing" ? "font-bold" : undefined}>
              <TableCell className="whitespace-normal">{row.title}</TableCell>
              {[row.capital, row.legalReserve, row.otherReserves, row.retainedEarnings, row.total].map(
                (amount, index) => (
                  <TableCell key={index} className={AMOUNT}>
                    <Amount value={amount} />
                  </TableCell>
                ),
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ReportNotes checks={report.checks} inferred={report.inferredAccounts} />
    </>
  );
}

export function TrialBalanceView({ report }: { report: TrialBalanceReport }) {
  const amounts = (row: TrialBalanceAmounts) =>
    report.groups.flatMap((group) => [row[`${group}Debit`], row[`${group}Credit`]]);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>کد</TableHead>
            <TableHead>نام حساب</TableHead>
            {report.groups.flatMap((group) =>
              ["بدهکار", "بستانکار"].map((side) => (
                <TableHead key={`${group}-${side}`} className="text-left">
                  {TRIAL_BALANCE_GROUP_LABELS[group]} {side}
                </TableHead>
              )),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row) => (
            <TableRow key={row.code}>
              <TableCell>{row.code}</TableCell>
              <TableCell className="min-w-40 whitespace-normal">{row.name}</TableCell>
              {amounts(row).map((amount, index) => (
                <TableCell key={index} className={AMOUNT}>
                  <Amount value={amount} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell />
            <TableCell>جمع</TableCell>
            {amounts(report.totals).map((amount, index) => (
              <TableCell key={index} className={AMOUNT}>
                <Amount value={amount} />
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
      {report.balanced === false && (
        <p role="alert" className="px-4 py-3 text-sm font-medium text-destructive">
          جمع بدهکار و بستانکار برابر نیست.
        </p>
      )}
    </>
  );
}

export function LedgerView({ report }: { report: LedgerReport }) {
  return (
    <>
      <p className="px-4 pt-3 text-sm font-medium">
        {report.accountCode} {report.accountName}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>تاریخ</TableHead>
            <TableHead>سند</TableHead>
            <TableHead>حساب</TableHead>
            <TableHead>تفصیلی</TableHead>
            <TableHead>شرح</TableHead>
            <TableHead className="text-left">بدهکار</TableHead>
            <TableHead className="text-left">بستانکار</TableHead>
            <TableHead className="text-left">مانده</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="font-bold">
            <TableCell colSpan={7}>مانده ابتدای دوره</TableCell>
            <TableCell className={AMOUNT}><Amount value={report.opening} /></TableCell>
          </TableRow>
          {report.lines.map((line, index) => (
            <TableRow key={`${line.journalEntryId}-${index}`}>
              <TableCell className="whitespace-nowrap">{formatJalaliDate(line.date)}</TableCell>
              <TableCell>{line.entryNumber}</TableCell>
              <TableCell>{line.accountCode}</TableCell>
              <TableCell>{line.partyCode ?? "—"}</TableCell>
              <TableCell className="min-w-48 whitespace-normal">{line.description}</TableCell>
              <TableCell className={AMOUNT}><Amount value={line.debit} /></TableCell>
              <TableCell className={AMOUNT}><Amount value={line.credit} /></TableCell>
              <TableCell className={AMOUNT}><Amount value={line.running} /></TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell colSpan={5}>جمع و مانده پایان دوره</TableCell>
            <TableCell className={AMOUNT}><Amount value={report.totalDebit} /></TableCell>
            <TableCell className={AMOUNT}><Amount value={report.totalCredit} /></TableCell>
            <TableCell className={AMOUNT}><Amount value={report.closing} /></TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {report.truncated && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          فهرست کوتاه شده است؛ جمع‌ها کامل‌اند. دوره را کوتاه‌تر کنید یا خروجی بگیرید.
        </p>
      )}
    </>
  );
}
