"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import { useAccess, switchToOrganization } from "@/components/app/access-provider";
import { listOrganizations } from "@/lib/api/access-client";
import { SYSTEM_ROLE_LABELS, type OrganizationSummary } from "@/types/access";

/** Lets a person who belongs to several organisations switch between them. */
export function OrgSwitcher() {
  const { org } = useAccess();
  const [orgs, setOrgs] = useState<OrganizationSummary[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listOrganizations(controller.signal)
      .then(setOrgs)
      .catch(() => undefined);
    return () => controller.abort();
  }, [org?.tenantId]);

  const active = orgs.filter((o) => o.status === "ACTIVE");
  if (active.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-1">
      <label htmlFor="org-switcher" className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <Building2 className="size-3.5" aria-hidden="true" />
        سازمان فعال
      </label>
      <select
        id="org-switcher"
        data-testid="org-switcher"
        value={org?.tenantId ?? ""}
        disabled={busy || active.length < 2}
        onChange={async (e) => {
          setBusy(true);
          try {
            await switchToOrganization(e.target.value);
          } finally {
            setBusy(false);
          }
        }}
        className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
      >
        {!org && <option value="">— انتخاب کنید —</option>}
        {active.map((o) => (
          <option key={o.tenantId} value={o.tenantId}>
            {o.tenantName} ({SYSTEM_ROLE_LABELS[o.roleKey] ?? o.roleKey})
          </option>
        ))}
      </select>
    </div>
  );
}
