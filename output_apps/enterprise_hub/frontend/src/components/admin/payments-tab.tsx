"use client";

import { useCallback, useState } from "react";
import { adminPost } from "@/lib/api/admin-console-client";
import { Badge, Btn, Card, ErrorBox, fa, Field, Notice, Select, Spinner, TableWrap, Td, Th, TextInput, useAction, useAdminData, when } from "./admin-ui";

interface Order {
  track_id: string;
  plan_type: string;
  status: string;
  method: string;
  amount_toman: number;
  amount_usdt: string | null;
  phone: string | null;
  user_ref: string | null;
  created_at: string;
  paid_at: string | null;
  tx_hash: string | null;
  gateway_ref_number: string | null;
  activation_suspect: boolean;
}
interface Unmatched {
  tx_hash: string;
  sender: string;
  amount_usdt: string;
  block_ts: string;
  reason: string;
  seen_at: string;
}

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "muted"> = { paid: "ok", pending: "warn", failed: "danger", expired: "muted" };
const REASON_FA: Record<string, string> = {
  near_open_invoice: "نزدیک به فاکتور باز",
  no_open_invoice: "فاکتور بازی نبود",
  ambiguous_amount: "مبلغ مبهم",
};

export function PaymentsTab({ onAuthLost }: { onAuthLost: () => void }) {
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const orders = useAdminData<{ orders: Order[]; errors: string[] }>("/payments", { method, status, limit: 100 }, onAuthLost, `${method}|${status}`);
  const unmatched = useAdminData<{ unmatched: Unmatched[]; errors: string[] }>("/payments/unmatched", undefined, onAuthLost);
  const [note, setNote] = useState<string | null>(null);

  const reverifyFn = useCallback(
    async (track_id: string, reason: string) => adminPost<{ verify_status: string; message: string; activation_pending: boolean }>("/payments/reverify", { track_id, reason }),
    [],
  );
  const reverify = useAction(reverifyFn, onAuthLost);

  async function doReverify(o: Order) {
    const reason = window.prompt(`دلیل بررسی دوبارهٔ سفارش ${o.track_id} در زیبال؟`);
    if (!reason || reason.trim().length < 3) return;
    const res = await reverify.run(o.track_id, reason.trim());
    if (res) {
      setNote(`نتیجهٔ استعلام ${o.track_id}: ${res.verify_status}${res.activation_pending ? " — فعال‌سازی ناقص ماند، اشتراک را دستی اعطا کنید" : ""}`);
      orders.reload();
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="سفارش‌ها (زیبال و USDT)"
        actions={
          <>
            <Select aria-label="روش" value={method} onChange={(e) => setMethod(e.target.value)} className="!w-auto">
              <option value="">همهٔ روش‌ها</option><option value="zibal">زیبال</option><option value="usdt_trc20">USDT</option>
            </Select>
            <Select aria-label="وضعیت" value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
              <option value="">همهٔ وضعیت‌ها</option><option value="paid">پرداخت‌شده</option><option value="pending">در انتظار</option>
              <option value="failed">ناموفق</option><option value="expired">منقضی</option>
            </Select>
            <Btn small variant="ghost" onClick={orders.reload}>بازخوانی</Btn>
          </>
        }
      >
        {note && <div className="mb-3"><Notice tone="info">{note}</Notice></div>}
        {reverify.error && <div className="mb-3"><Notice tone="danger">{reverify.error}</Notice></div>}
        {orders.loading && !orders.data ? <Spinner /> : orders.error && !orders.data ? <ErrorBox error={orders.error} onRetry={orders.reload} /> : (
          <>
            {orders.data?.errors.length ? <Notice tone="warn">{orders.data.errors.join(" | ")}</Notice> : null}
            <TableWrap>
              <thead><tr><Th>شناسه پیگیری</Th><Th>روش</Th><Th>پلن</Th><Th>مبلغ</Th><Th>وضعیت</Th><Th>کاربر</Th><Th>زمان</Th><Th /></tr></thead>
              <tbody>
                {(orders.data?.orders ?? []).map((o) => (
                  <tr key={o.track_id}>
                    <Td mono>{o.track_id}{o.tx_hash && <div className="text-[10px] text-[var(--gh-muted)]">tx {o.tx_hash.slice(0, 12)}…</div>}</Td>
                    <Td>{o.method === "usdt_trc20" ? "USDT" : "زیبال"}</Td>
                    <Td>{o.plan_type}</Td>
                    <Td className="tabular-nums">{o.method === "usdt_trc20" ? `${o.amount_usdt ?? "?"} USDT` : `${fa(o.amount_toman)} ت`}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[o.status] ?? "muted"}>{o.status}</Badge>
                      {o.activation_suspect && <div className="mt-1"><Badge tone="danger">فعال‌سازی ناقص؟</Badge></div>}
                    </Td>
                    <Td mono>{o.phone ?? (o.user_ref ? `${o.user_ref.slice(0, 8)}…` : "—")}</Td>
                    <Td>{when(o.paid_at ?? o.created_at)}</Td>
                    <Td>{o.method !== "usdt_trc20" && o.status !== "paid" && <Btn small variant="ghost" disabled={reverify.busy} onClick={() => void doReverify(o)}>استعلام دوباره</Btn>}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {(orders.data?.orders ?? []).length === 0 && <p className="mt-2 text-sm text-[var(--gh-muted)]">سفارشی با این فیلتر نیست.</p>}
          </>
        )}
        <p className="mt-3 text-[11px] text-[var(--gh-muted)]">
          «استعلام دوباره» فقط برای سفارش‌های زیبالِ پرداخت‌نشده است؛ سرور مبلغ را با فاکتور می‌سنجد و تکراری فعال نمی‌کند. «فعال‌سازی ناقص؟» یعنی پرداخت اخیر بدون اشتراک فعال.
        </p>
      </Card>

      <Card title="تراکنش‌های USDT بدون سفارش" actions={<Btn small variant="ghost" onClick={unmatched.reload}>بازخوانی</Btn>}>
        {unmatched.loading && !unmatched.data ? <Spinner /> : unmatched.error && !unmatched.data ? <ErrorBox error={unmatched.error} onRetry={unmatched.reload} /> : (
          <div className="space-y-3">
            {unmatched.data?.errors.map((e) => <Notice key={e} tone="info">{e}</Notice>)}
            {(unmatched.data?.unmatched ?? []).length === 0 && <p className="text-sm text-[var(--gh-muted)]">تراکنش تطبیق‌نشدهٔ بازی وجود ندارد.</p>}
            {(unmatched.data?.unmatched ?? []).map((u) => <MatchRow key={u.tx_hash} tx={u} onAuthLost={onAuthLost} onDone={() => { unmatched.reload(); orders.reload(); }} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function MatchRow({ tx, onAuthLost, onDone }: { tx: Unmatched; onAuthLost: () => void; onDone: () => void }) {
  const [trackId, setTrackId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const fn = useCallback(
    async (body: { track_id: string; tx_hash: string; reason: string }) => adminPost<{ activated: boolean; activation_pending: boolean }>("/payments/match-crypto", body),
    [],
  );
  const match = useAction(fn, onAuthLost);

  async function go() {
    if (!window.confirm(`تراکنش ${tx.amount_usdt} USDT به سفارش ${trackId} وصل و اشتراک فعال شود؟ سرور مبلغ، آدرس و بلاکچین را دوباره بررسی می‌کند.`)) return;
    const res = await match.run({ track_id: trackId.trim(), tx_hash: tx.tx_hash, reason: reason.trim() });
    if (res) {
      setResult(res.activated ? "تطبیق و فعال‌سازی انجام شد." : "تطبیق انجام شد ولی فعال‌سازی ناقص ماند؛ اشتراک را از تب کاربران اعطا کنید.");
      onDone();
    }
  }

  return (
    <div className="rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="warn">{fa(Number(tx.amount_usdt), 6)} USDT</Badge>
        <Badge>{REASON_FA[tx.reason] ?? tx.reason}</Badge>
        <span className="text-xs text-[var(--gh-muted)]">{when(tx.block_ts)}</span>
      </div>
      <p dir="ltr" className="mt-1 break-all font-mono text-[11px] text-[var(--gh-muted)]">tx {tx.tx_hash} ← {tx.sender}</p>
      <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <Field label="شناسه سفارش (USDT_…)"><TextInput dir="ltr" value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="USDT_xxxxxxxx" /></Field>
        <Field label="دلیل"><TextInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        <div className="self-end"><Btn type="submit" disabled={match.busy || !/^USDT_[0-9a-f]{32}$/.test(trackId.trim()) || reason.trim().length < 3}>تطبیق با سفارش</Btn></div>
      </form>
      {match.error && <div className="mt-2"><Notice tone="danger">{match.error}</Notice></div>}
      {result && <div className="mt-2"><Notice tone="ok">{result}</Notice></div>}
    </div>
  );
}
