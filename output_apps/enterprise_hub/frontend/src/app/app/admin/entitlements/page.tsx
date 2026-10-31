"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { SELECT_CLASS, errorText, useAction, useLoad } from "@/components/access/access-ui";
import { PageHeader } from "@/components/app/app-ui";
import { useAuth } from "@/components/auth/auth-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  adminGetEntitlements, adminListTenants, adminOpenRequests, adminSetEntitlements,
} from "@/lib/api/access-client";
import { MODULE_LABELS, type AccessModuleKey, type EntitlementView } from "@/types/access";

/** Roxira staff only: which modules each customer organisation may use. The server rejects everyone else. */
export default function EntitlementsAdminPage() {
  const { user } = useAuth();
  const isOperator = user?.role === "ADMIN";
  const tenants = useLoad((s) => (isOperator ? adminListTenants(s) : Promise.resolve([])));
  const requests = useLoad((s) => (isOperator ? adminOpenRequests(s) : Promise.resolve([])));
  const [tenantId, setTenantId] = useState("");
  const [rows, setRows] = useState<EntitlementView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const action = useAction(requests.reload);

  useEffect(() => {
    if (!tenantId) return;
    adminGetEntitlements(tenantId).then(setRows).catch((e) => setError(errorText(e)));
  }, [tenantId]);

  if (!isOperator) {
    return <p role="alert" data-testid="no-access" className="rounded-xl border border-border p-4 text-sm text-muted-foreground">این صفحه فقط برای تیم روکسیرا است.</p>;
  }

  const toggle = async (module: string, enabled: boolean) => {
    setError(null);
    const res = await action.run(() => adminSetEntitlements(tenantId, [{ module, enabled }]));
    if (res) setRows(res);
  };
  const tenantName = (id: string) => tenants.data?.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  return (
    <>
      <PageHeader title="ماژول‌های مشتریان" description="فعال یا غیرفعال‌کردن ماژول برای هر سازمان. وابستگی‌ها (مثلاً حقوق و دستمزد به حسابداری) اعمال می‌شود." icon={<KeyRound className="size-6 text-indigo-500" />} />
      {(error || action.error) && <Alert variant="destructive"><AlertDescription>{error ?? action.error}</AlertDescription></Alert>}
      {(requests.data ?? []).length > 0 && (
        <section className="rounded-2xl border border-border p-4" data-testid="open-requests">
          <h3 className="mb-2 text-sm font-bold">درخواست‌های باز</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {(requests.data ?? []).map((r) => (
              <li key={r.id}><button type="button" className="text-indigo-300 hover:underline" onClick={() => setTenantId(r.tenantId)}>{tenantName(r.tenantId)}</button> — {MODULE_LABELS[r.module as AccessModuleKey] ?? r.module}</li>
            ))}
          </ul>
        </section>
      )}
      <select aria-label="سازمان" className={SELECT_CLASS} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
        <option value="">— سازمان را انتخاب کنید —</option>
        {(tenants.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {tenantId && (
        <div className="grid gap-2 md:grid-cols-2" data-testid="entitlement-list">
          {rows.map((r) => (
            <label key={r.module} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              {MODULE_LABELS[r.module]}
              <input type="checkbox" aria-label={MODULE_LABELS[r.module]} checked={r.enabled} disabled={action.busy} onChange={(e) => toggle(r.module, e.target.checked)} />
            </label>
          ))}
        </div>
      )}
    </>
  );
}
