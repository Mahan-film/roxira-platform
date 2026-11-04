"use client";

import { Workflow } from "lucide-react";

import { useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAccounts } from "@/lib/api/accounting-client";
import { clearPostingRole, listPostingRules, setPostingRole } from "@/lib/api/posting-rules-client";
import { accountsForRole, SOURCE_LABELS } from "@/lib/posting-rules";

type AccountRow = { code: string; name: string; accountType: string; level?: string | null };

/** Which account each role uses when a document of a type is posted automatically. */
export default function PostingRulesPage() {
  const { can } = useAccess();
  const admin = can("accounting", "admin");
  const rules = useLoad((s) => listPostingRules(s));
  const accounts = useLoad((s) => listAccounts(s));
  const action = useAction(rules.reload);
  const chart = (accounts.data ?? []) as unknown as AccountRow[];

  return (
    <>
      <PageHeader title="ثبت خودکار سند" description="برای هر نوع سند مشخص کنید هر نقش (مثلاً بانک، حقوق پرداختنی) به کدام حساب دفتر کل برود." icon={<Workflow className="size-6 text-indigo-500" />} />
      {!admin && <Alert><AlertDescription>فقط مدیر حسابداری می‌تواند این تنظیمات را تغییر دهد.</AlertDescription></Alert>}
      {(rules.error || accounts.error) && <Alert variant="destructive"><AlertDescription>{rules.error ?? accounts.error}</AlertDescription></Alert>}
      {action.error && <Alert variant="destructive" data-testid="posting-error"><AlertDescription>{action.error}</AlertDescription></Alert>}
      <div className="flex flex-col gap-4" data-testid="posting-templates">
        {(rules.data ?? []).map((t) => (
          <section key={t.docType} className="rounded-2xl border border-border p-4" data-doc-type={t.docType}>
            <h2 className="mb-3 font-bold">{t.title} <span className="text-xs font-normal text-muted-foreground" dir="ltr">{t.docType}</span></h2>
            <div className="flex flex-col gap-2">
              {t.roles.map((r) => {
                const options = accountsForRole(chart, r.types);
                return (
                  <div key={r.role} className="flex flex-wrap items-center gap-2" data-role={r.role}>
                    <span className="min-w-56 text-sm">{r.label}</span>
                    <select
                      className="h-9 min-w-64 rounded-lg border border-border bg-background px-2 text-sm"
                      aria-label={`حساب نقش ${r.label}`}
                      value={r.accountCode ?? ""}
                      disabled={!admin || action.busy}
                      onChange={(e) => e.target.value && action.run(() => setPostingRole(t.docType, r.role, e.target.value))}
                    >
                      {!r.accountCode && <option value="">— انتخاب حساب —</option>}
                      {r.accountCode && !options.some((o) => o.code === r.accountCode) && <option value={r.accountCode}>{r.accountCode} {r.accountName ?? "(نامعتبر)"}</option>}
                      {options.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.name}</option>)}
                    </select>
                    <Badge variant={r.source === "default" ? "outline" : "secondary"}>{SOURCE_LABELS[r.source]}</Badge>
                    {!r.valid && <Badge variant="destructive">حساب نامعتبر یا تعریف‌نشده</Badge>}
                    {admin && r.source === "document" && (
                      <Button size="sm" variant="ghost" disabled={action.busy} onClick={() => action.run(() => clearPostingRole(t.docType, r.role))}>بازگشت به پیش‌فرض</Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
