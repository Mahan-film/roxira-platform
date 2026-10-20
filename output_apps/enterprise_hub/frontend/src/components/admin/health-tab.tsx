"use client";

import { Badge, Btn, Card, ErrorBox, fa, Notice, Spinner, TableWrap, Td, Th, useAdminData, when } from "./admin-ui";

interface Container {
  name: string;
  image: string;
  state: string;
  status: string;
  healthy: boolean;
}
interface Disk {
  path: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  used_pct: number;
}
interface Timer {
  unit: string;
  state: string;
  enabled?: string;
  next?: string;
  last?: string;
}
interface Health {
  containers: { status: string; reason?: string; containers: Container[] };
  disk: Disk[];
  last_deploy: { available: boolean; time?: string; target?: string; deployed_before?: string; migrated?: boolean; result?: string; failed_shas?: number | null };
  host: { available: boolean; hint?: string; stale?: boolean; generated_at?: string; timers?: Timer[]; disk?: Disk[]; load?: number[]; uptime_s?: number | null };
}

function diskTone(pct: number): "ok" | "warn" | "danger" {
  return pct >= 90 ? "danger" : pct >= 75 ? "warn" : "ok";
}

export function HealthTab({ onAuthLost }: { onAuthLost: () => void }) {
  const q = useAdminData<Health>("/health", undefined, onAuthLost);
  if (q.loading && !q.data) return <Spinner />;
  if (q.error && !q.data) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (!d) return null;
  const disks = d.host.available && d.host.disk?.length ? d.host.disk : d.disk;
  const bad = d.containers.containers.filter((c) => !c.healthy).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={d.containers.status !== "ok" ? "warn" : bad ? "danger" : "ok"}>
          {d.containers.status !== "ok" ? "فهرست کانتینرها در دسترس نیست" : bad ? `${fa(bad)} کانتینر ناسالم` : "همهٔ کانتینرها سالم"}
        </Badge>
        <Btn small variant="ghost" onClick={q.reload} disabled={q.loading}>بازخوانی</Btn>
      </div>

      <Card title="کانتینرها (فقط‌خواندنی، از docker-socket-proxy)">
        {d.containers.status !== "ok" ? (
          <Notice tone="info">پروکسی داکر پاسخ نداد ({d.containers.reason}). اپ باید به شبکهٔ docker_proxy_net وصل باشد.</Notice>
        ) : (
          <TableWrap>
            <thead><tr><Th>نام</Th><Th>وضعیت</Th><Th>ایمیج</Th></tr></thead>
            <tbody>
              {d.containers.containers.map((c) => (
                <tr key={c.name}>
                  <Td mono>{c.name}</Td>
                  <Td><Badge tone={c.healthy ? "ok" : "danger"}>{c.state}</Badge> <span className="text-xs text-[var(--gh-muted)]" dir="ltr">{c.status}</span></Td>
                  <Td mono className="max-w-[240px] break-all">{c.image}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="دیسک">
          {disks.length === 0 ? <p className="text-sm text-[var(--gh-muted)]">اطلاعاتی نیست.</p> : (
            <ul className="space-y-2">
              {disks.map((x) => (
                <li key={x.path} className="text-sm">
                  <div className="flex items-center justify-between gap-2"><span dir="ltr" className="font-mono text-xs">{x.path}</span><Badge tone={diskTone(x.used_pct)}>{fa(x.used_pct, 1)}٪ پر</Badge></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--gh-surface-2)]"><div className="h-full bg-[var(--gh-cyan)]" style={{ width: `${Math.min(100, x.used_pct)}%` }} /></div>
                  <div className="mt-0.5 text-[11px] text-[var(--gh-muted)]">{fa(x.free_gb, 1)} گیگابایت آزاد از {fa(x.total_gb, 1)}</div>
                </li>
              ))}
            </ul>
          )}
          {d.host.available && d.host.load && <p className="mt-2 text-xs text-[var(--gh-muted)]">بار سرور: <span dir="ltr">{d.host.load.join(" / ")}</span></p>}
        </Card>
        <Card title="آخرین استقرار (autodeploy)">
          {!d.last_deploy.available ? <Notice tone="info">پروندهٔ autodeploy-last.json مانت نشده است.</Notice> : (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-[var(--gh-muted)]">نتیجه</dt><dd><Badge tone={d.last_deploy.result === "ok" ? "ok" : d.last_deploy.result === "failed" ? "danger" : "muted"}>{d.last_deploy.result}</Badge></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-[var(--gh-muted)]">زمان</dt><dd dir="ltr">{d.last_deploy.time}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-[var(--gh-muted)]">کامیت</dt><dd dir="ltr" className="font-mono text-xs">{(d.last_deploy.target ?? "").slice(0, 10)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-[var(--gh-muted)]">مایگریشن</dt><dd>{d.last_deploy.migrated ? "بله" : "خیر"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-[var(--gh-muted)]">SHAهای ناموفق</dt><dd>{fa(d.last_deploy.failed_shas ?? null)}</dd></div>
            </dl>
          )}
        </Card>
      </div>

      <Card title="تایمرهای کلیدی (systemd، فقط‌خواندنی)">
        {!d.host.available ? (
          <Notice tone="info">اسنپ‌شات میزبان موجود نیست. روی سرور: <span dir="ltr" className="font-mono">sudo scripts/ops/admin/install.sh --yes</span>. {d.host.hint}</Notice>
        ) : (
          <>
            {d.host.stale && <div className="mb-2"><Notice tone="warn">اسنپ‌شات قدیمی است (آخرین: {when(d.host.generated_at)}). تایمر roxira-admin-snapshot را بررسی کنید.</Notice></div>}
            <TableWrap>
              <thead><tr><Th>تایمر</Th><Th>وضعیت</Th><Th>اجرای بعدی</Th><Th>آخرین اجرا</Th></tr></thead>
              <tbody>
                {(d.host.timers ?? []).map((t) => (
                  <tr key={t.unit}>
                    <Td mono>{t.unit}</Td>
                    <Td><Badge tone={t.state === "active" ? "ok" : t.state === "not installed" ? "muted" : "danger"}>{t.state}</Badge> <span className="text-xs text-[var(--gh-muted)]">{t.enabled}</span></Td>
                    <Td className="text-xs" >{t.next || "—"}</Td><Td className="text-xs">{t.last || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </>
        )}
      </Card>
    </div>
  );
}
