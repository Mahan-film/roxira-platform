"use client";

import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Layers, Lock, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ACTION_LABELS,
  MODULE_LABELS,
  SCOPE_TYPE_LABELS,
  SENSITIVE_FIELD_LABELS,
  SYSTEM_ROLE_LABELS,
  type AccessActionKey,
  type AccessModuleKey,
  type CustomRole,
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
const ALL_SENSITIVE_FIELDS: SensitiveField[] = ["cost", "margin", "salary"];

interface Props {
  rolesData: RolesResponse;
  entitledModules?: string[];
}

export function PermissionMatrixView({ rolesData, entitledModules = [] }: Props) {
  const [selectedRole, setSelectedRole] = useState<string>("all");
  const [search, setSearch] = useState("");

  const entitledSet = useMemo(() => new Set(entitledModules), [entitledModules]);

  // Combine system roles and custom roles into a unified view list
  const allRolesList = useMemo(() => {
    const list: Array<{
      key: string;
      id: string;
      name: string;
      isCustom: boolean;
      permissions: Set<string>;
      customRole?: CustomRole;
    }> = [];

    for (const sys of rolesData.system) {
      if (sys.deprecated) continue;
      list.push({
        key: sys.key,
        id: sys.key,
        name: SYSTEM_ROLE_LABELS[sys.key] ?? sys.key,
        isCustom: false,
        permissions: new Set(sys.permissions),
      });
    }

    for (const cust of rolesData.custom) {
      list.push({
        key: `custom-${cust.id}`,
        id: cust.id,
        name: cust.name,
        isCustom: true,
        permissions: new Set(cust.permissions),
        customRole: cust,
      });
    }

    return list;
  }, [rolesData]);

  // Filter modules by search
  const filteredModules = useMemo(() => {
    return rolesData.catalogue.modules.filter((mod: AccessModuleKey) => {
      const label = MODULE_LABELS[mod] ?? mod;
      if (!search.trim()) return true;
      return label.toLowerCase().includes(search.toLowerCase()) || mod.toLowerCase().includes(search.toLowerCase());
    });
  }, [rolesData.catalogue.modules, search]);

  const activeRolesToDisplay = useMemo(() => {
    if (selectedRole === "all") return allRolesList;
    return allRolesList.filter((r) => r.id === selectedRole || r.key === selectedRole);
  }, [allRolesList, selectedRole]);

  return (
    <div className="flex flex-col gap-6" data-testid="permission-matrix-view">
      {/* Filters Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-indigo-500" />
              ماتریس جامع اختیارات و مجوزهای سازمان
            </span>
            <Badge variant="outline" className="text-xs">
              {allRolesList.length} نقش تعریف‌شده
            </Badge>
          </CardTitle>
          <CardDescription>
            بررسی دسترسی‌های عملیاتی، رؤیت فیلدهای حساس (بها، سود، حقوق) و سقف‌های مجاز مالی به تفکیک نقش
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-48">
            <Input
              placeholder="جستجوی نام ماژول..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="role-select" className="text-xs font-medium text-muted-foreground">
              فیلتر نقش:
            </label>
            <select
              id="role-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus:ring-1 focus:ring-ring"
            >
              <option value="all">همه نقش‌ها (مقایسه‌ای)</option>
              <optgroup label="نقش‌های استاندارد سامانه">
                {rolesData.system
                  .filter((r) => !r.deprecated)
                  .map((r) => (
                    <option key={r.key} value={r.key}>
                      {SYSTEM_ROLE_LABELS[r.key] ?? r.key}
                    </option>
                  ))}
              </optgroup>
              {rolesData.custom.length > 0 && (
                <optgroup label="نقش‌های سفارشی">
                  {rolesData.custom.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (سفارشی)
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Main Matrix Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">جدول مجوزهای عملیاتی (اقدامات × ماژول‌ها)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs text-start border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="p-3 text-start font-semibold">ماژول سازمانی</th>
                <th className="p-3 text-center font-semibold">وضعیت اشتراک</th>
                {activeRolesToDisplay.map((role) => (
                  <th key={role.id} className="p-3 text-center font-semibold min-w-28 border-s border-border/50">
                    <div>{role.name}</div>
                    <div className="text-[10px] font-normal text-muted-foreground mt-0.5">
                      {role.isCustom ? "نقش سفارشی" : "سیستمی"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredModules.map((mod: AccessModuleKey) => {
                const isEntitled = CORE_MODULES.includes(mod) || entitledSet.has(mod);
                return (
                  <tr key={mod} className="border-b border-border/60 hover:bg-muted/20 transition-colors">
                    <td className="p-3 font-medium">
                      <div>{MODULE_LABELS[mod] ?? mod}</div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{mod}</div>
                    </td>
                    <td className="p-3 text-center">
                      {isEntitled ? (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600">
                          فعال
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                          غیرفعال
                        </Badge>
                      )}
                    </td>
                    {activeRolesToDisplay.map((role) => {
                      const actionsAllowed = ALL_ACTIONS.filter(
                        (act) => role.key === "owner" || role.permissions.has(`${mod}:${act}`),
                      );
                      const isFull = actionsAllowed.length === ALL_ACTIONS.length;
                      const isNone = actionsAllowed.length === 0;

                      return (
                        <td key={role.id} className="p-3 text-center border-s border-border/50 align-top">
                          {isNone ? (
                            <span className="text-muted-foreground text-xs font-mono">—</span>
                          ) : isFull ? (
                            <div className="flex flex-col items-center justify-center gap-1">
                              <Badge className="bg-emerald-600 text-white text-[10px] px-2 py-0.5">
                                دسترسی کامل ({actionsAllowed.length})
                              </Badge>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1 justify-center">
                              {actionsAllowed.map((act) => (
                                <span
                                  key={act}
                                  title={`${MODULE_LABELS[mod]} : ${ACTION_LABELS[act]}`}
                                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                                >
                                  {ACTION_LABELS[act]}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Sensitive Fields Visibility & Scopes Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Sensitive Fields */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="size-4 text-amber-500" />
              رؤیت فیلدهای حساس و محرمانه
            </CardTitle>
            <CardDescription>
              وضعیت نمایش بهای تمام‌شده، سود و اطلاعات حقوق و دستمزد در فرم‌ها و گزارش‌ها
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {activeRolesToDisplay.map((role) => {
              const visibility = getEffectiveFieldVisibility(
                role.isCustom ? "custom" : role.key,
                role.customRole,
              );
              return (
                <div key={role.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border">
                  <div className="font-medium text-xs">{role.name}</div>
                  <div className="flex items-center gap-1.5">
                    {ALL_SENSITIVE_FIELDS.map((f) => {
                      const visible = visibility[f];
                      return (
                        <Badge
                          key={f}
                          variant={visible ? "secondary" : "outline"}
                          className={`text-[10px] gap-1 ${
                            visible
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "text-muted-foreground opacity-70"
                          }`}
                        >
                          {visible ? <Check className="size-3 text-emerald-600" /> : <X className="size-3 text-rose-500" />}
                          {SENSITIVE_FIELD_LABELS[f]}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Scope and Amount Limits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="size-4 text-blue-500" />
              محدوده جغرافیایی و سقف‌های ریالی
            </CardTitle>
            <CardDescription>
              حوزه مجاز شعبه/انبار و سقف مبلغ تراکنش‌ها در اسناد
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {activeRolesToDisplay.map((role) => {
              const scope = getEffectiveScope(
                role.isCustom ? "custom" : role.key,
                role.customRole,
              );
              const limits = role.customRole?.amountLimits ?? {};
              const hasLimits = Object.keys(limits).length > 0;

              return (
                <div key={role.id} className="flex flex-col gap-2 p-2.5 rounded-lg border border-border text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{role.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      محدوده: {SCOPE_TYPE_LABELS[scope.type]}
                    </Badge>
                  </div>
                  {hasLimits ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {Object.entries(limits).map(([perm, limit]) => (
                        <span
                          key={perm}
                          className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-300/30"
                        >
                          سقف {perm === "*" ? "کلی" : perm}: {formatRialDisplay(limit)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      سقف ریالی: {role.key === "owner" ? "نامحدود (مالک)" : "پیش‌فرض نقش"}
                    </span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
