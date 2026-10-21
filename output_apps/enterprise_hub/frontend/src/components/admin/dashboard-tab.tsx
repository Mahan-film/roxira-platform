"use client";

import { Badge, Btn, Card, ErrorBox, fa, Notice, Spinner, Stat, TableWrap, Td, Th, useAdminData } from "./admin-ui";

type Level = "free" | "basic" | "pro" | "premium" | "team";
interface WindowData {
  since: string;
  new_users: number | null;
  new_email_users: number | null;
  new_phone_users: number | null;
  active_users: number | null;
  questions_by_plan: Record<Level, number> | null;
  paid_orders: number | null;
  paid_by_method: Record<string, number>;
  revenue_toman: number;
  revenue_usdt: number;
  revenue_usd_equiv: number | null;
  orders_by_status: Record<string, number> | null;
  llm_calls: number;
  llm_errors: number;
  error_rate: number;
  llm_cost_usd: number;
  margin_usd: number | null;
}
interface UmamiSite {
  [window: string]: { visitors: number; pageviews: number };
}
interface Dashboard {
  generated_at: string;
  usd_toman_rate: number | null;
  windows: Record<"today" | "d7" | "d30", WindowData>;
  subscriptions_by_level: Record<Level, number> | null;
  subscriptions_by_plan: Record<string, number> | null;
  pending_activation: number | null;
  umami: { status: string; reason?: string; sites?: Record<string, UmamiSite> };
  cost_log: { path_ok: boolean };
  errors: string[];
}

const WINDOWS: { key: "today" | "d7" | "d30"; label: string }[] = [
  { key: "today", label: "امروز" },
  { key: "d7", label: "۷ روز" },
  { key: "d30", label: "۳۰ روز" },
];
const LEVELS: { key: Level; label: string }[] = [
  { key: "free", label: "رایگان" },
  { key: "basic", label: "پایه" },
  { key: "pro", label: "حرفه‌ای" },
  { key: "premium", label: "ویژه" },
  { key: "team", label: "تیمی" },
];

function usd(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `$${fa(n, 2)}`;
}

export function DashboardTab({ onAuthLost }: { onAuthLost: () => void }) {
  const q = useAdminData<Dashboard>("/dashboard", undefined, onAuthLost);
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--gh-muted)]">
          «امروز» از نیمه‌شب تهران؛ به‌روزرسانی: {new Date(d.generated_at).toLocaleTimeString("fa-IR")}
          {d.usd_toman_rate ? ` — نرخ تبدیل: ${fa(d.usd_toman_rate)} تومان` : " — نرخ دلار نامشخص (حاشیه سود تومان‌ها حساب نمی‌شود)"}
        </p>
        <Btn small variant="ghost" onClick={q.reload} disabled={q.loading}>بازخوانی</Btn>
      </div>
      {d.errors.length > 0 && <Notice tone="warn">بعضی بخش‌ها خوانده نشد: {d.errors.slice(0, 4).join(" | ")}</Notice>}
      {(d.pending_activation ?? 0) > 0 && (
        <Notice tone="danger">
          {fa(d.pending_activation)} سفارش پرداخت‌شدهٔ اخیر هنوز اشتراکی ندارد (احتمال خطای فعال‌سازی). در تب «پرداخت‌ها» با برچسب «فعال‌سازی ناقص» ببینید و در «کاربران» اشتراک را اعطا کنید.
        </Notice>
      )}
      {!d.cost_log.path_ok && <Notice tone="warn">گزارش هزینهٔ LLM (requests.jsonl) روی اپ مانت نشده است؛ هزینه و نرخ خطا صفر نمایش داده می‌شود.</Notice>}

      <TableWrap>
        <thead>
          <tr>
            <Th>شاخص</Th>
            {WINDOWS.map((w) => <Th key={w.key}>{w.label}</Th>)}
          </tr>
        </thead>
        <tbody>
          <Row label="کاربر جدید (ایمیل + موبایل)" cells={WINDOWS.map((w) => fa(d.windows[w.key].new_users))} />
          <Row label="کاربر فعال (پرسش‌گر)" cells={WINDOWS.map((w) => fa(d.windows[w.key].active_users))} />
          {LEVELS.map((l) => (
            <Row key={l.key} label={`پرسش‌ها — ${l.label}`} cells={WINDOWS.map((w) => fa(d.windows[w.key].questions_by_plan?.[l.key]))} />
          ))}
          <Row label="سفارش پرداخت‌شده" cells={WINDOWS.map((w) => fa(d.windows[w.key].paid_orders))} />
          <Row label="درآمد (تومان)" cells={WINDOWS.map((w) => fa(d.windows[w.key].revenue_toman))} />
          <Row label="درآمد (USDT)" cells={WINDOWS.map((w) => fa(d.windows[w.key].revenue_usdt, 2))} />
          <Row label="هزینهٔ LLM" cells={WINDOWS.map((w) => usd(d.windows[w.key].llm_cost_usd))} />
          <Row label="حاشیهٔ سود (دلار)" cells={WINDOWS.map((w) => usd(d.windows[w.key].margin_usd))} strong />
          <Row label="درخواست‌های LLM" cells={WINDOWS.map((w) => fa(d.windows[w.key].llm_calls))} />
          <Row label="نرخ خطای LLM" cells={WINDOWS.map((w) => `${fa(d.windows[w.key].error_rate * 100, 1)}٪`)} />
        </tbody>
      </TableWrap>
      <p className="text-[11px] text-[var(--gh-muted)]">
        پرسش‌ها فقط از کاربران واردشده شمرده می‌شود (مهمان‌ها ذخیره نمی‌شوند) و پلن «فعلی» کاربر است. کاربر جدید موبایلی = اولین گفتگو.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="اشتراک‌های فعال به تفکیک سطح">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LEVELS.filter((l) => l.key !== "free").map((l) => (
              <Stat key={l.key} label={l.label} value={fa(d.subscriptions_by_level?.[l.key])} tone="gold" />
            ))}
          </div>
          {d.subscriptions_by_plan && (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(d.subscriptions_by_plan).map(([plan, n]) => <Badge key={plan} tone="cyan">{plan}: {fa(n)}</Badge>)}
            </div>
          )}
        </Card>
        <Card title="بازدید سایت (Umami)">
          {d.umami.status !== "ok" || !d.umami.sites ? (
            <Notice tone="info">در دسترس نیست: {d.umami.reason ?? d.umami.status}. برای فعال‌سازی متغیرهای UMAMI_* را در .env سرور بگذارید.</Notice>
          ) : (
            <TableWrap>
              <thead><tr><Th>سایت</Th>{WINDOWS.map((w) => <Th key={w.key}>{w.label}</Th>)}</tr></thead>
              <tbody>
                {Object.entries(d.umami.sites).map(([host, per]) => (
                  <tr key={host}>
                    <Td mono>{host}</Td>
                    {WINDOWS.map((w) => <Td key={w.key}>{fa(per[w.key]?.visitors)} بازدیدکننده / {fa(per[w.key]?.pageviews)} صفحه</Td>)}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, cells, strong }: { label: string; cells: string[]; strong?: boolean }) {
  return (
    <tr className={strong ? "bg-[var(--gh-surface-2)] font-semibold text-[var(--gh-gold)]" : ""}>
      <Td>{label}</Td>
      {cells.map((c, i) => <Td key={i} className="tabular-nums">{c}</Td>)}
    </tr>
  );
}
