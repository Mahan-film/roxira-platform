"use client";

import { Badge, Btn, Card, ErrorBox, fa, Notice, Spinner, TableWrap, Td, Th, useAdminData, when } from "./admin-ui";

interface GroupRow {
  group: string;
  calls: number;
  errors: number;
  empties: number;
  p50_ms: number;
  p95_ms: number;
  cost_usd: number;
  is_fallback_target: boolean;
}
interface Models {
  gateway: { enabled: boolean; configured: boolean; default_group: string };
  tier_mapping: { tier: string; group: string; fallback_chain: string[] }[];
  config_found: boolean;
  last_hour: GroupRow[];
  last_24h: GroupRow[];
  cost_log_found: boolean;
  note: string;
  bakeoff: { available: boolean; instructions?: string; name?: string; modified?: string; markdown?: string; truncated?: boolean; others?: string[] };
}

export function ModelsTab({ onAuthLost }: { onAuthLost: () => void }) {
  const q = useAdminData<Models>("/models", undefined, onAuthLost);
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={d.gateway.enabled ? "ok" : "danger"}>{d.gateway.enabled ? "درگاه key-pool روشن" : "درگاه key-pool خاموش (مسیر مستقیم OpenRouter)"}</Badge>
        <Badge tone={d.gateway.configured ? "ok" : "warn"}>{d.gateway.configured ? "کلید درگاه تنظیم است" : "کلید درگاه تنظیم نیست"}</Badge>
        <Badge>گروه پیش‌فرض: {d.gateway.default_group}</Badge>
        <Btn small variant="ghost" onClick={q.reload} disabled={q.loading}>بازخوانی</Btn>
      </div>

      <Card title="نگاشت سطح اشتراک به گروه مدل">
        <TableWrap>
          <thead><tr><Th>سطح</Th><Th>گروه</Th><Th>زنجیرهٔ جایگزین (fallback)</Th></tr></thead>
          <tbody>
            {d.tier_mapping.map((m) => (
              <tr key={m.tier}>
                <Td>{m.tier}</Td><Td mono>{m.group}</Td>
                <Td mono>{m.fallback_chain.length ? m.fallback_chain.join(" → ") : d.config_found ? "—" : "config/key_pool.yaml مانت نشده"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {!d.cost_log_found && <Notice tone="warn">گزارش requests.jsonl روی اپ مانت نشده است؛ آمار گروه‌ها خالی است.</Notice>}
      <GroupTable title="درخواست‌ها در ۱ ساعت اخیر" rows={d.last_hour} />
      <GroupTable title="درخواست‌ها در ۲۴ ساعت اخیر" rows={d.last_24h} />
      <p className="text-[11px] text-[var(--gh-muted)]">{d.note}</p>

      <Card title="گزارش آخرین بیک‌آف مدل‌ها">
        {d.bakeoff.available ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="cyan">{d.bakeoff.name}</Badge>
              <span className="text-xs text-[var(--gh-muted)]">{when(d.bakeoff.modified)}</span>
              {d.bakeoff.truncated && <Badge tone="warn">کوتاه‌شده</Badge>}
            </div>
            <pre dir="auto" className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--gh-border)] bg-[var(--gh-bg-2)] p-3 text-xs">{d.bakeoff.markdown}</pre>
          </div>
        ) : (
          <Notice tone="info">
            <span dir="ltr" className="block whitespace-pre-wrap text-left text-xs">{d.bakeoff.instructions}</span>
          </Notice>
        )}
      </Card>
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-[var(--gh-muted)]">درخواستی ثبت نشده.</p> : (
        <TableWrap>
          <thead><tr><Th>گروه</Th><Th>درخواست</Th><Th>خطا</Th><Th>پاسخ خالی</Th><Th>p50 (ms)</Th><Th>p95 (ms)</Th><Th>هزینه ($)</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group}>
                <Td mono>{r.group} {r.is_fallback_target && <Badge tone="warn">fallback</Badge>}</Td>
                <Td className="tabular-nums">{fa(r.calls)}</Td>
                <Td className={r.errors ? "text-[var(--gh-danger)]" : ""}>{fa(r.errors)}</Td>
                <Td className={r.empties ? "text-[var(--gh-gold)]" : ""}>{fa(r.empties)}</Td>
                <Td>{fa(r.p50_ms)}</Td><Td>{fa(r.p95_ms)}</Td><Td>{fa(r.cost_usd, 4)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}
