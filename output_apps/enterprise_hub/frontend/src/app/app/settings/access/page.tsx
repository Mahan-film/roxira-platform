"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Eye, HelpCircle, Layers, ShieldCheck } from "lucide-react";

import { PermissionMatrixView } from "@/components/access/permission-matrix-view";
import { PreviewAsUserPanel } from "@/components/access/preview-as-user-panel";
import { ExplainDenialPanel } from "@/components/access/explain-denial-panel";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  listBranches,
  listDepartments,
  listMembers,
  listMyEntitlements,
  listRoles,
} from "@/lib/api/access-client";
import { cn } from "@/lib/utils";
import type { Branch, Department, EntitlementView, Member, RolesResponse } from "@/types/access";

const TABS = [
  { id: "matrix", label: "ماتریس دسترسی‌ها", icon: Layers },
  { id: "preview", label: "پیش‌نمایش دیدگاه کاربر", icon: Eye },
  { id: "explain", label: "تحلیل رد دسترسی (Explain Denial)", icon: HelpCircle },
] as const;

type TabKey = (typeof TABS)[number]["id"];

export default function AccessSettingsPage() {
  const { can, org, loading: accessLoading } = useAccess();
  const [activeTab, setActiveTab] = useState<TabKey>("matrix");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rolesData, setRolesData] = useState<RolesResponse | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementView[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    setLoading(true);
    Promise.all([
      listRoles(signal),
      listMembers(signal),
      listBranches(signal),
      listDepartments(signal),
      listMyEntitlements(signal).catch(() => []),
    ])
      .then(([rolesRes, membersRes, branchesRes, deptsRes, entitlementsRes]) => {
        setRolesData(rolesRes);
        setMembers(membersRes);
        setBranches(branchesRes);
        setDepartments(deptsRes);
        setEntitlements(entitlementsRes);
        setError(null);
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        setError(err instanceof Error ? err.message : "خطا در بارگذاری اطلاعات دسترسی‌ها");
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  // Access check: requires members:read
  if (!accessLoading && !can("members", "read")) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-border p-4 text-sm text-muted-foreground"
        data-testid="no-access"
      >
        نقش شما به مشاهده ماتریس دسترسی‌ها مجاز نیست.
      </p>
    );
  }

  const entitledModulesList = entitlements.filter((e) => e.enabled).map((e) => e.module);
  const effectiveEntitled =
    entitledModulesList.length > 0 ? entitledModulesList : (org?.entitledModules ?? []);

  return (
    <div className="flex flex-col gap-6" data-testid="access-settings-page">
      <PageHeader
        title="ماتریس و کنترل دسترسی‌ها"
        description="بررسی ماتریس اختیارات سازمانی، پیش‌نمایش دیدگاه کاربران، سقف‌های مالی و عیب‌یابی علل رد دسترسی‌ها"
        icon={<ShieldCheck className="size-6 text-indigo-500" />}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="بخش‌های ماتریس و کنترل دسترسی"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const isSelected = activeTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isSelected}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                isSelected
                  ? "bg-indigo-500/15 font-bold text-indigo-600 dark:text-indigo-300 border-b-2 border-indigo-500"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
              )}
            >
              <Icon className="size-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          در حال بارگذاری اطلاعات دسترسی‌ها و ماتریس اختیارات…
        </div>
      ) : !rolesData ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>اطلاعات نقش‌ها و ماتریس دسترسی بارگذاری نشد.</AlertDescription>
        </Alert>
      ) : (
        <>
          {activeTab === "matrix" && (
            <PermissionMatrixView
              rolesData={rolesData}
              entitledModules={effectiveEntitled}
            />
          )}

          {activeTab === "preview" && (
            <PreviewAsUserPanel
              members={members}
              rolesData={rolesData}
              branches={branches}
              departments={departments}
              entitledModules={effectiveEntitled}
            />
          )}

          {activeTab === "explain" && (
            <ExplainDenialPanel
              members={members}
              rolesData={rolesData}
              branches={branches}
              entitledModules={effectiveEntitled}
            />
          )}
        </>
      )}
    </div>
  );
}
