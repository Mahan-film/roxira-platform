"use client";

import { useState } from "react";
import { ClipboardList } from "lucide-react";

import { errorText, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { listAudit, verifyAuditChain } from "@/lib/api/access-client";
import type { AuditEntry } from "@/types/access";

/** Immutable, tenant-scoped audit log (owner/admin). */
export default function AuditPage() {
  const { can, loading } = useAccess();
  const first = useLoad((signal) => listAudit({ limit: 50 }, signal));
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<string | null>(null);

  const items = [...(first.data?.items ?? []), ...more];
  const next = cursor === undefined ? (first.data?.items.length === 50 ? first.data.nextBefore : null) : cursor;
  const loadMore = async (before: string) => {
    try {
      const res = await listAudit({ before, limit: 50 });
      setMore((prev) => [...prev, ...res.items]);
      setCursor(res.items.length === 50 ? res.nextBefore : null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!loading && !can("audit", "read")) {
    return <p role="alert" data-testid="no-access" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">فقط مالک و مدیر می‌توانند گزارش رخدادها را ببینند.</p>;
  }

  return (
    <>
      <PageHeader
        title="گزارش رخدادها"
        description="چه کسی چه کاری کرده است. این فهرست قابل ویرایش یا حذف نیست."
        icon={<ClipboardList className="size-6 text-indigo-500" />}
        actions={
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const r = await verifyAuditChain();
                setChain(r.ok ? `زنجیرهٔ ${r.checked} رخداد سالم است.` : `زنجیره در رخداد ${r.brokenAtId} دچار تغییر شده است.`);
              } catch (e) {
                setChain(errorText(e));
              }
            }}
          >
            بررسی صحت زنجیره
          </Button>
        }
      />
      {chain && <Alert data-testid="chain-result"><AlertDescription>{chain}</AlertDescription></Alert>}
      {(error || first.error) && <Alert variant="destructive"><AlertDescription>{error ?? first.error}</AlertDescription></Alert>}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm" data-testid="audit-table">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr><th className="p-3 text-start">زمان</th><th className="p-3 text-start">رخداد</th><th className="p-3 text-start">منبع</th><th className="p-3 text-start">کاربر</th><th className="p-3 text-start">IP</th></tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="p-3 text-xs">{new Date(a.createdAt).toLocaleString("fa-IR")}</td>
                <td className="p-3 font-mono text-xs" dir="ltr">{a.action}</td>
                <td className="p-3 text-xs" dir="ltr">{[a.resourceType, a.resourceId].filter(Boolean).join(" ")}</td>
                <td className="p-3 font-mono text-xs" dir="ltr">{a.actorUserId?.slice(0, 8) ?? "—"}</td>
                <td className="p-3 font-mono text-xs" dir="ltr">{a.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && <Button variant="outline" onClick={() => loadMore(next)}>بیشتر</Button>}
    </>
  );
}
