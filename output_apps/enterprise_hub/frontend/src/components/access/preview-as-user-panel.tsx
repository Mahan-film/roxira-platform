"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Layers, Shield, User, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ACTION_LABELS,
  MODULE_LABELS,
  SCOPE_TYPE_LABELS,
  SENSITIVE_FIELD_LABELS,
  SYSTEM_ROLE_LABELS,
  type AccessActionKey,
  type AccessModuleKey,
  type Branch,
  type CustomRole,
  type Department,
  type Member,
  type RolesResponse,
  type SensitiveField,
} from "@/types/access";
import {
  CORE_MODULES,
  formatRialDisplay,
  getEffectiveFieldVisibility,
  getEffectiveScope,
} from "@/lib/access-evaluator";

const ALL_ACTIONS: AccessActionKey[] = ["read", "create", "approve", "post", "export", "admin"];
const ALL_SENSITIVE_FIELDS: SensitiveField[] = ["salary", "cost", "margin"];

interface Props {
  members: Member[];
  rolesData: RolesResponse;
  branches: Branch[];
  departments: Department[];
  entitledModules?: string[];
}

export function PreviewAsUserPanel({
  members,
  rolesData,
  branches,
  departments,
  entitledModules = [],
}: Props) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>(members[0]?.id ?? "");

  const entitledSet = useMemo(() => new Set(entitledModules), [entitledModules]);

  const selectedMember = useMemo(() => {
    return members.find((m) => m.id === selectedMemberId) ?? members[0] ?? null;
  }, [members, selectedMemberId]);

  const customRole = useMemo<CustomRole | null>(() => {
    if (!selectedMember || selectedMember.roleKey !== "custom" || !selectedMember.customRoleId) {
      return null;
    }
    return rolesData.custom.find((c) => c.id === selectedMember.customRoleId) ?? null;
  }, [selectedMember, rolesData.custom]);

  const memberBranch = useMemo(() => {
    if (!selectedMember?.branchId) return null;
    return branches.find((b) => b.id === selectedMember.branchId) ?? null;
  }, [selectedMember, branches]);

  const memberDept = useMemo(() => {
    if (!selectedMember?.departmentId) return null;
    return departments.find((d) => d.id === selectedMember.departmentId) ?? null;
  }, [selectedMember, departments]);

  const effectiveVisibility = useMemo(() => {
    if (!selectedMember) return { cost: false, margin: false, salary: false };
    return getEffectiveFieldVisibility(selectedMember.roleKey, customRole);
  }, [selectedMember, customRole]);

  const effectiveScope = useMemo(() => {
    if (!selectedMember) return { type: "org" as const, ids: [] };
    return getEffectiveScope(selectedMember.roleKey, customRole, selectedMember);
  }, [selectedMember, customRole]);

  const memberPermissions = useMemo<Set<string>>(() => {
    if (!selectedMember) return new Set();
    if (selectedMember.roleKey === "owner") {
      const all = new Set<string>();
      for (const m of rolesData.catalogue.modules) {
        for (const a of ALL_ACTIONS) all.add(`${m}:${a}`);
      }
      return all;
    }
    if (selectedMember.roleKey === "custom" && customRole) {
      return new Set(customRole.permissions);
    }
    const sys = rolesData.system.find((r) => r.key === selectedMember.roleKey);
    return new Set(sys?.permissions ?? []);
  }, [selectedMember, customRole, rolesData]);

  if (!selectedMember) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          هیچ کاربری در سازمان یافت نشد.
        </CardContent>
      </Card>
    );
  }

  const roleTitle =
    selectedMember.roleKey === "custom"
      ? `نقش سفارشی: ${customRole?.name ?? "نامشخص"}`
      : SYSTEM_ROLE_LABELS[selectedMember.roleKey] ?? selectedMember.roleKey;

  return (
    <div className="flex flex-col gap-6" data-testid="preview-as-user-panel">
      {/* User Selector Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <User className="size-5 text-indigo-500" />
              پیش‌نمایش اختیارات کاربر (دیدگاه کاربر)
            </span>
            <Badge variant="outline" className="text-xs">
              {members.length} کاربر عضو
            </Badge>
          </CardTitle>
          <CardDescription>
            مشاهده خروجی نهایی سطح دسترسی، محدودیت‌های جغرافیایی و سقف‌های ریالی از نگاه یک کاربر خاص
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-64">
              <label htmlFor="member-select" className="text-xs font-medium text-muted-foreground block mb-1">
                انتخاب کاربر جهت شبیه‌سازی:
              </label>
              <select
                id="member-select"
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:ring-1 focus:ring-ring"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.username || m.loginEmail || m.phone} — {SYSTEM_ROLE_LABELS[m.roleKey] ?? m.roleKey}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selected Member Summary Card */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Identity & Role */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="size-4 text-indigo-500" />
              شناسه و نقش
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-border/40">
              <span className="text-muted-foreground">نام کاربر:</span>
              <span className="font-bold">{selectedMember.displayName || "بدون نام"}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-border/40">
              <span className="text-muted-foreground">نام کاربری:</span>
              <span className="font-mono">{selectedMember.username || selectedMember.loginEmail || "—"}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-border/40">
              <span className="text-muted-foreground">عنوان نقش:</span>
              <Badge variant="secondary" className="text-xs">
                {roleTitle}
              </Badge>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-muted-foreground">وضعیت:</span>
              <Badge
                variant={selectedMember.status === "ACTIVE" ? "default" : "destructive"}
                className="text-[10px]"
              >
                {selectedMember.status === "ACTIVE" ? "فعال" : "معلق"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Sensitive Fields Visibility */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Eye className="size-4 text-amber-500" />
              فیلدهای حساس و محرمانه
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            {ALL_SENSITIVE_FIELDS.map((f) => {
              const visible = effectiveVisibility[f];
              return (
                <div key={f} className="flex justify-between items-center py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-muted-foreground">{SENSITIVE_FIELD_LABELS[f]}:</span>
                  <div className="flex items-center gap-1">
                    {visible ? (
                      <span className="flex items-center gap-1 text-emerald-600 font-medium">
                        <CheckCircle2 className="size-3.5" />
                        مجاز (قابل مشاهده)
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-rose-500 font-medium">
                        <XCircle className="size-3.5" />
                        مخفی (مسدود)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Scope and Limits */}
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="size-4 text-blue-500" />
              محدوده شعبه و سقف مالی
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between items-center py-1 border-b border-border/40">
              <span className="text-muted-foreground">شعبه انتسابی:</span>
              <span className="font-medium">{memberBranch?.name ?? "کل سازمان (بدون شعبه)"}</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-border/40">
              <span className="text-muted-foreground">محدودیت شعبه:</span>
              <Badge variant="outline" className="text-[10px]">
                {selectedMember.branchScoped ? "بله (فقط شعبه خودش)" : "خیر (سراسری)"}
              </Badge>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-border/40">
              <span className="text-muted-foreground">دپارتمان:</span>
              <span>{memberDept?.name ?? "تعیین‌نشده"}</span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-muted-foreground">سقف ثبت اسناد:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                {customRole?.amountLimits?.["*"]
                  ? formatRialDisplay(customRole.amountLimits["*"])
                  : selectedMember.roleKey === "owner"
                  ? "نامحدود"
                  : "سقف استاندارد نقش"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Complete Permissions Breakdown by Module */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">فهرست کامل اختیارات عملیاتی کاربر</CardTitle>
          <CardDescription>
            بررسی دسترسی‌های مجاز این کاربر در تمامی ماژول‌های فعال سازمان
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rolesData.catalogue.modules.map((mod: AccessModuleKey) => {
              const isEntitled = CORE_MODULES.includes(mod) || entitledSet.has(mod);
              const allowedInMod = ALL_ACTIONS.filter((act) => memberPermissions.has(`${mod}:${act}`));

              return (
                <div
                  key={mod}
                  className={`p-3 rounded-xl border transition-all ${
                    !isEntitled
                      ? "border-border/40 bg-muted/20 opacity-60"
                      : allowedInMod.length > 0
                      ? "border-border bg-card shadow-2xs"
                      : "border-border/60 bg-muted/10"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border/40">
                    <span className="font-semibold text-xs">{MODULE_LABELS[mod] ?? mod}</span>
                    {isEntitled ? (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600">
                        فعال در بسته
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                        غیرفعال در بسته
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ALL_ACTIONS.map((act) => {
                      const hasPerm = memberPermissions.has(`${mod}:${act}`);
                      const canActuallyDo = isEntitled && hasPerm;

                      return (
                        <span
                          key={act}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                            canActuallyDo
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-800"
                              : "bg-muted/40 text-muted-foreground/60 border border-transparent"
                          }`}
                        >
                          {canActuallyDo ? <CheckCircle2 className="size-2.5" /> : null}
                          {ACTION_LABELS[act]}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
