"use client";

import { useState } from "react";
import { UsersRound } from "lucide-react";

import { InvitationsPanel } from "@/components/access/invitations-panel";
import { MembersPanel } from "@/components/access/members-panel";
import { RolesPanel } from "@/components/access/roles-panel";
import { StructurePanel } from "@/components/access/structure-panel";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "members", label: "اعضا" },
  { id: "invitations", label: "دعوت‌نامه‌ها" },
  { id: "roles", label: "نقش‌ها" },
  { id: "structure", label: "ساختار سازمان" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/** Owner/admin screen: members, invitations, roles and branches/departments. The server enforces every action. */
export default function MembersSettingsPage() {
  const { can, loading } = useAccess();
  const [tab, setTab] = useState<Tab>("members");

  if (!loading && !can("members", "read")) {
    return (
      <p role="alert" className="rounded-xl border border-border p-4 text-sm text-muted-foreground" data-testid="no-access">
        نقش شما به مدیریت اعضا دسترسی ندارد.
      </p>
    );
  }

  return (
    <>
      <PageHeader
        title="اعضا و نقش‌ها"
        description="اعضا را دعوت کنید، نقش بدهید و ساختار شعبه‌ها و دپارتمان‌ها را بسازید."
        icon={<UsersRound className="size-6 text-indigo-500" />}
      />
      <div role="tablist" aria-label="بخش‌های مدیریت اعضا" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-t-lg px-4 py-2 text-sm",
              tab === t.id ? "bg-indigo-500/15 font-bold text-indigo-300" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "members" && <MembersPanel />}
      {tab === "invitations" && <InvitationsPanel />}
      {tab === "roles" && <RolesPanel />}
      {tab === "structure" && <StructurePanel />}
    </>
  );
}
