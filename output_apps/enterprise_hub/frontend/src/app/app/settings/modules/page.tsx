"use client";

import { Puzzle } from "lucide-react";

import { useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModuleCatalogue, requestModule } from "@/lib/api/access-client";
import { MODULE_LABELS, type AccessModuleKey } from "@/types/access";

/** Add-modules page: what the organisation has, what it could add, and what each needs. No prices. */
export default function ModulesPage() {
  const { can } = useAccess();
  const cat = useLoad((s) => getModuleCatalogue(s));
  const action = useAction(cat.reload);
  const admin = can("members", "admin");
  const label = (m: string) => MODULE_LABELS[m as AccessModuleKey] ?? m;

  return (
    <>
      <PageHeader title="ماژول‌ها" description="ماژول‌های فعال سازمان و ماژول‌هایی که می‌توانید درخواست دهید." icon={<Puzzle className="size-6 text-indigo-500" />} />
      {cat.data?.allEnabled && <Alert data-testid="trial-note"><AlertDescription>در دورهٔ آزمایشی همهٔ ماژول‌ها برای همهٔ سازمان‌ها باز است.</AlertDescription></Alert>}
      {cat.error && <Alert variant="destructive"><AlertDescription>{cat.error}</AlertDescription></Alert>}
      {action.error && <Alert variant="destructive"><AlertDescription>{action.error}</AlertDescription></Alert>}
      <div className="grid gap-3 md:grid-cols-2" data-testid="module-list">
        {(cat.data?.modules ?? []).map((m) => (
          <div key={m.module} className="flex flex-col gap-2 rounded-2xl border border-border p-4" data-module={m.module}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{label(m.module)}</span>
              {m.enabled ? <Badge variant="secondary">فعال</Badge> : m.requested ? <Badge variant="outline">درخواست شده</Badge> : <Badge variant="outline">غیرفعال</Badge>}
            </div>
            {m.dependsOn.length > 0 && <p className="text-xs text-muted-foreground">نیازمند: {m.dependsOn.map(label).join("، ")}</p>}
            {!m.enabled && !m.requested && admin && (
              <Button size="sm" variant="outline" disabled={action.busy} onClick={() => action.run(() => requestModule(m.module))}>درخواست فعال‌سازی</Button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
