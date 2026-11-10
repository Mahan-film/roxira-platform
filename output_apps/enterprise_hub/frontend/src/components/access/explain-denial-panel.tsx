"use client";

import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Search, ShieldAlert, Sparkles, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ACTION_LABELS,
  MODULE_LABELS,
  SENSITIVE_FIELD_LABELS,
  SYSTEM_ROLE_LABELS,
  type AccessActionKey,
  type AccessModuleKey,
  type Branch,
  type CustomRole,
  type Member,
  type RolesResponse,
  type SensitiveField,
} from "@/types/access";
import {
  evaluateClientAccess,
  formatRialDisplay,
  parseRialAmount,
  type AccessEvaluationResult,
} from "@/lib/access-evaluator";

const ALL_ACTIONS: AccessActionKey[] = ["read", "create", "approve", "post", "export", "admin"];
const ALL_SENSITIVE_FIELDS: SensitiveField[] = ["salary", "cost", "margin"];

interface Props {
  members: Member[];
  rolesData: RolesResponse;
  branches: Branch[];
  entitledModules?: string[];
}

export function ExplainDenialPanel({
  members,
  rolesData,
  branches,
  entitledModules = [],
}: Props) {
  // Inputs
  const [targetType, setTargetType] = useState<"member" | "role">("member");
  const [selectedMemberId, setSelectedMemberId] = useState<string>(members[0]?.id ?? "");
  const [selectedRoleKey, setSelectedRoleKey] = useState<string>("accountant");
  const [selectedModule, setSelectedModule] = useState<AccessModuleKey>("invoicing");
  const [selectedAction, setSelectedAction] = useState<AccessActionKey>("post");
  const [amountInput, setAmountInput] = useState<string>("");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [selectedField, setSelectedField] = useState<string>("none");

  // Lookup target user or role
  const targetMember = useMemo(() => {
    if (targetType !== "member") return null;
    return members.find((m) => m.id === selectedMemberId) ?? members[0] ?? null;
  }, [targetType, members, selectedMemberId]);

  const activeRoleKey = useMemo(() => {
    if (targetType === "member") {
      return targetMember?.roleKey ?? "accountant";
    }
    return selectedRoleKey.startsWith("custom-") ? "custom" : selectedRoleKey;
  }, [targetType, targetMember, selectedRoleKey]);

  const customRole = useMemo<CustomRole | null>(() => {
    if (targetType === "member") {
      if (targetMember?.roleKey === "custom" && targetMember.customRoleId) {
        return rolesData.custom.find((c) => c.id === targetMember.customRoleId) ?? null;
      }
      return null;
    }
    if (selectedRoleKey.startsWith("custom-")) {
      const customId = selectedRoleKey.replace("custom-", "");
      return rolesData.custom.find((c) => c.id === customId) ?? null;
    }
    return null;
  }, [targetType, targetMember, selectedRoleKey, rolesData.custom]);

  // Real-time evaluation result
  const evaluation = useMemo<AccessEvaluationResult>(() => {
    return evaluateClientAccess({
      roleKey: activeRoleKey,
      customRole,
      member: targetMember,
      entitledModules,
      module: selectedModule,
      action: selectedAction,
      amountRials: amountInput ? parseRialAmount(amountInput).toString() : undefined,
      branchId: selectedBranchId ? selectedBranchId : undefined,
      field: selectedField !== "none" ? (selectedField as SensitiveField) : undefined,
    });
  }, [
    activeRoleKey,
    customRole,
    targetMember,
    entitledModules,
    selectedModule,
    selectedAction,
    amountInput,
    selectedBranchId,
    selectedField,
  ]);

  const parsedAmount = parseRialAmount(amountInput);

  return (
    <div className="flex flex-col gap-6" data-testid="explain-denial-panel">
      {/* Intro Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-indigo-500" />
              تحلیل و توضیح علل رد یا قبول دسترسی (Explain Denial)
            </span>
            <Badge variant="outline" className="text-xs">
              موتور اعتبارسنجی زنده
            </Badge>
          </CardTitle>
          <CardDescription>
            آزمایش و عیب‌یابی دقیق سناریوهای مختلف؛ چرا یک عملیات رد شد و مدیر سازمان چگونه می‌تواند آن را رفع کند؟
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Target mode: Member or Role */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">مبنای بررسی:</label>
              <div className="flex rounded-md border border-input p-1 bg-muted/20">
                <button
                  type="button"
                  onClick={() => setTargetType("member")}
                  className={`flex-1 py-1 text-xs rounded transition-colors ${
                    targetType === "member" ? "bg-background shadow-xs font-bold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  یک کاربر خاص
                </button>
                <button
                  type="button"
                  onClick={() => setTargetType("role")}
                  className={`flex-1 py-1 text-xs rounded transition-colors ${
                    targetType === "role" ? "bg-background shadow-xs font-bold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  یک نقش سازمانی
                </button>
              </div>
            </div>

            {/* Target selection */}
            {targetType === "member" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="member-select" className="text-xs font-medium text-muted-foreground">
                  انتخاب کاربر:
                </label>
                <select
                  id="member-select"
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName || m.username || m.loginEmail} ({SYSTEM_ROLE_LABELS[m.roleKey] ?? m.roleKey})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="role-select" className="text-xs font-medium text-muted-foreground">
                  انتخاب نقش:
                </label>
                <select
                  id="role-select"
                  value={selectedRoleKey}
                  onChange={(e) => setSelectedRoleKey(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-xs"
                >
                  <optgroup label="نقش‌های سیستمی">
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
                        <option key={c.id} value={`custom-${c.id}`}>
                          {c.name} (سفارشی)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}

            {/* Target Module */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="module-select" className="text-xs font-medium text-muted-foreground">
                ماژول هدف:
              </label>
              <select
                id="module-select"
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value as AccessModuleKey)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                {rolesData.catalogue.modules.map((m: AccessModuleKey) => (
                  <option key={m} value={m}>
                    {MODULE_LABELS[m] ?? m}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Action */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="action-select" className="text-xs font-medium text-muted-foreground">
                اقدام مورد نظر:
              </label>
              <select
                id="action-select"
                value={selectedAction}
                onChange={(e) => setSelectedAction(e.target.value as AccessActionKey)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                {ALL_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]} ({a})
                  </option>
                ))}
              </select>
            </div>

            {/* Sensitive field check */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="field-select" className="text-xs font-medium text-muted-foreground">
                بررسی فیلد حساس (اختیاری):
              </label>
              <select
                id="field-select"
                value={selectedField}
                onChange={(e) => setSelectedField(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="none">بدون فیلد حساس (عملیات عمومی)</option>
                {ALL_SENSITIVE_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {SENSITIVE_FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>

            {/* Amount limit check */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="amount-input" className="text-xs font-medium text-muted-foreground">
                مبلغ تراکنش به ریال (اختیاری):
              </label>
              <Input
                id="amount-input"
                dir="ltr"
                placeholder="مثال: ۵۰,۰۰۰,۰۰۰"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="h-9 text-xs font-mono"
              />
              {parsedAmount > BigInt(0) && (
                <span className="text-[10px] text-muted-foreground text-start">
                  معادل: {formatRialDisplay(parsedAmount)}
                </span>
              )}
            </div>

            {/* Branch check */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="branch-select" className="text-xs font-medium text-muted-foreground">
                شعبه هدف (اختیاری):
              </label>
              <select
                id="branch-select"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              >
                <option value="">شعبه پیش‌فرض / مرکزی</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Decision Card */}
      <Card className={`border-2 transition-all ${evaluation.allowed ? "border-emerald-500/40 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/5"}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {evaluation.allowed ? (
                <CheckCircle2 className="size-8 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="size-8 text-rose-600 shrink-0" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-foreground">
                    نتیجه ارزیابی: {evaluation.summaryFa}
                  </h3>
                  {evaluation.code && (
                    <Badge variant="outline" className="font-mono text-xs border-rose-400 text-rose-600">
                      {evaluation.code}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{evaluation.reasonFa}</p>
              </div>
            </div>
            <Badge className={evaluation.allowed ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}>
              {evaluation.allowed ? "مجاز (PASS)" : "رد شد (DENIED)"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Remediation Guide */}
          <div className={`p-3 rounded-xl border text-xs ${
            evaluation.allowed
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300"
              : "bg-rose-500/10 border-rose-500/20 text-rose-900 dark:text-rose-200"
          }`}>
            <div className="font-semibold flex items-center gap-1.5 mb-1">
              <Sparkles className="size-4" />
              راهنمای مدیر و اصلاح دسترسی:
            </div>
            <p className="text-xs leading-relaxed">{evaluation.remediationFa}</p>
          </div>

          {/* Step-by-Step Security Pipeline Checks */}
          <div>
            <h4 className="text-xs font-bold text-muted-foreground mb-2">
              کنترل زنجیره امنیتی (خط مشی ۵ مرحله‌ای):
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {evaluation.checks.map((chk, i) => (
                <div
                  key={i}
                  className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                    chk.passed
                      ? "border-emerald-200 dark:border-emerald-900/60 bg-background/60"
                      : "border-rose-300 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20"
                  }`}
                >
                  {chk.passed ? (
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="size-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="font-medium flex items-center justify-between">
                      <span>{chk.nameFa}</span>
                      <span className={chk.passed ? "text-emerald-600 text-[10px]" : "text-rose-600 text-[10px]"}>
                        {chk.passed ? "تأیید شد" : "عدم انطباق"}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {chk.messageFa}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
