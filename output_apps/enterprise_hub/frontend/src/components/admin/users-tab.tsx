"use client";

import { useCallback, useState } from "react";
import { adminGet, adminPost } from "@/lib/api/admin-console-client";
import { Badge, Btn, Card, Field, fa, Notice, Select, TableWrap, Td, Th, TextArea, TextInput, useAction, when } from "./admin-ui";

interface Entitlement {
  plan_type: string;
  status: string;
  activated_at: string;
  expires_at: string;
  active: boolean;
}
interface Lookup {
  kind: "phone" | "email";
  identity_hint: string;
  user_ref: string;
  entitlement: Entitlement | null;
  level: string;
  usage_today: { used_by_level: Record<string, number>; limits: Record<string, number>; top_model_used: Record<string, number | null> };
  recent_orders: { track_id: string; plan_type: string; status: string; amount_rial: number; created_at: string; paid_at: string | null; method?: string }[];
  recent_audit: AuditRow[];
  grantable_plans: string[];
}
interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target: string;
  reason: string;
  ts: string;
}

const LEVEL_FA: Record<string, string> = { free: "رایگان", basic: "پایه", pro: "حرفه‌ای", premium: "ویژه" };
const ACTION_FA: Record<string, string> = { grant: "اعطا / جایگزینی اشتراک", extend: "تمدید", revoke: "لغو (انقضای فوری)" };

export function UsersTab({ onAuthLost }: { onAuthLost: () => void }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<Lookup | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const lookupFn = useCallback(async (query: string) => adminGet<Lookup>("/users/lookup", { q: query }), []);
  const lookup = useAction(lookupFn, onAuthLost);
  const auditFn = useCallback(async () => adminGet<{ audit: AuditRow[] }>("/audit", { limit: 50 }), []);
  const auditLoad = useAction(auditFn, onAuthLost);

  async function search() {
    setDone(null);
    setData(null);
    const res = await lookup.run(q.trim());
    if (res) setData(res);
  }

  return (
    <div className="space-y-4">
      <Card title="جست‌وجوی کاربر">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <TextInput dir="ltr" placeholder="09xxxxxxxxx یا email@example.com" value={q} onChange={(e) => setQ(e.target.value)} aria-label="شماره یا ایمیل" />
          <Btn type="submit" disabled={lookup.busy || q.trim().length < 4}>جست‌وجو</Btn>
        </form>
        {lookup.error && <div className="mt-3"><Notice tone="danger">{lookup.error}</Notice></div>}
      </Card>

      {data && (
        <>
          <Card title={<>کاربر <span dir="ltr" className="font-mono text-[var(--gh-text)]">{data.identity_hint}</span></>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Info label="نوع حساب" value={data.kind === "email" ? "ایمیل" : "موبایل"} />
              <Info label="سطح فعلی" value={<Badge tone={data.level === "free" ? "muted" : "warn"}>{LEVEL_FA[data.level] ?? data.level}</Badge>} />
              <Info label="پلن" value={data.entitlement?.plan_type ?? "—"} />
              <Info label="انقضا" value={data.entitlement ? <>{when(data.entitlement.expires_at)} {data.entitlement.active ? <Badge tone="ok">فعال</Badge> : <Badge tone="danger">منقضی</Badge>}</> : "—"} />
            </div>
            <p className="mt-3 text-xs text-[var(--gh-muted)]">مصرف امروز (پرسش‌های پاسخ‌داده‌شده):</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.keys(data.usage_today.used_by_level).length === 0 && <Badge>امروز پرسشی ثبت نشده</Badge>}
              {Object.entries(data.usage_today.used_by_level).map(([lvl, n]) => (
                <Badge key={lvl} tone="cyan">{LEVEL_FA[lvl] ?? lvl}: {fa(n)} از {fa(data.usage_today.limits[lvl])}</Badge>
              ))}
              {Object.entries(data.usage_today.top_model_used).filter(([, n]) => n).map(([lvl, n]) => <Badge key={lvl}>مدل برتر {LEVEL_FA[lvl]}: {fa(n)}</Badge>)}
            </div>
            <p dir="ltr" className="mt-3 break-all font-mono text-[11px] text-[var(--gh-muted)]">user_ref: {data.user_ref}</p>
          </Card>

          <EntitlementForm data={data} onAuthLost={onAuthLost} onDone={(msg) => { setDone(msg); void search(); }} />
          {done && <Notice tone="ok">{done}</Notice>}

          <Card title="سفارش‌های اخیر این کاربر">
            {data.recent_orders.length === 0 ? <p className="text-sm text-[var(--gh-muted)]">سفارشی نیست.</p> : (
              <TableWrap>
                <thead><tr><Th>شناسه</Th><Th>پلن</Th><Th>وضعیت</Th><Th>مبلغ (تومان)</Th><Th>زمان</Th></tr></thead>
                <tbody>
                  {data.recent_orders.map((o) => (
                    <tr key={o.track_id}>
                      <Td mono>{o.track_id}</Td><Td>{o.plan_type}</Td><Td>{o.status}</Td>
                      <Td>{o.amount_rial ? fa(o.amount_rial / 10) : o.method === "usdt_trc20" ? "USDT" : "—"}</Td><Td>{when(o.paid_at ?? o.created_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
          <AuditTable rows={data.recent_audit} title="تغییرات ثبت‌شدهٔ مدیر برای این کاربر" />
        </>
      )}

      <Card title="دفتر ممیزی (۵۰ مورد آخر، همهٔ کاربران)" actions={<Btn small variant="ghost" disabled={auditLoad.busy} onClick={async () => { const r = await auditLoad.run(); if (r) setAudit(r.audit); }}>نمایش</Btn>}>
        {auditLoad.error && <Notice tone="danger">{auditLoad.error}</Notice>}
        {audit && <AuditTable rows={audit} />}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3">
      <div className="text-xs text-[var(--gh-muted)]">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}

function AuditTable({ rows, title }: { rows: AuditRow[]; title?: string }) {
  if (rows.length === 0) return title ? <Card title={title}><p className="text-sm text-[var(--gh-muted)]">موردی نیست.</p></Card> : <p className="text-sm text-[var(--gh-muted)]">موردی نیست.</p>;
  const table = (
    <TableWrap>
      <thead><tr><Th>زمان</Th><Th>مدیر</Th><Th>عملیات</Th><Th>هدف</Th><Th>دلیل</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>{when(r.ts)}</Td><Td mono>{r.actor}</Td><Td>{r.action}</Td><Td mono className="max-w-[140px] truncate">{r.target}</Td><Td>{r.reason}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
  return title ? <Card title={title}>{table}</Card> : table;
}

function EntitlementForm({ data, onAuthLost, onDone }: { data: Lookup; onAuthLost: () => void; onDone: (msg: string) => void }) {
  const [action, setAction] = useState<"grant" | "extend" | "revoke">("grant");
  const [plan, setPlan] = useState(data.grantable_plans.find((p) => p === "SJ_PRO_MONTHLY") ?? data.grantable_plans[0] ?? "");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");

  const submitFn = useCallback(
    async (body: Record<string, unknown>) => adminPost<{ status: string }>("/users/entitlement", body),
    [],
  );
  const submit = useAction(submitFn, onAuthLost);

  async function go() {
    const body: Record<string, unknown> = { user_ref: data.user_ref, action, reason: reason.trim() };
    if (action === "grant") body.plan_type = plan;
    if (action !== "revoke" && days.trim()) body.days = Number(days);
    if (action === "extend" && !days.trim()) return;
    if (!window.confirm(`${ACTION_FA[action]} برای ${data.identity_hint}؟ این کار در دفتر ممیزی ثبت می‌شود.`)) return;
    const res = await submit.run(body);
    if (res) {
      setReason("");
      onDone("انجام شد و در دفتر ممیزی ثبت گردید.");
    }
  }

  return (
    <Card title="اعطا / تمدید / لغو اشتراک">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label="عملیات">
          <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
            {Object.entries(ACTION_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        {action === "grant" && (
          <Field label="پلن">
            <Select dir="ltr" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {data.grantable_plans.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
        )}
        {action !== "revoke" && (
          <Field label="تعداد روز" hint={action === "grant" ? "خالی = مدت پیش‌فرض پلن (۳۰ / ۳۶۵ / ۷ روز)" : "الزامی"}>
            <TextInput dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} placeholder="30" />
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="دلیل (الزامی، در دفتر ممیزی ثبت می‌شود)">
            <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        </div>
        {submit.error && <div className="sm:col-span-2"><Notice tone="danger">{submit.error}</Notice></div>}
        <div className="sm:col-span-2">
          <Btn type="submit" variant={action === "revoke" ? "danger" : "primary"} disabled={submit.busy || reason.trim().length < 3 || (action === "extend" && !days.trim())}>
            ثبت
          </Btn>
        </div>
      </form>
    </Card>
  );
}
