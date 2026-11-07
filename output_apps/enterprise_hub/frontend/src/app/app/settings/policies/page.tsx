"use client";

import { useState } from "react";
import { Lock, SlidersHorizontal } from "lucide-react";

import { SELECT_CLASS, useAction, useLoad } from "@/components/access/access-ui";
import { useAccess } from "@/components/app/access-provider";
import { PageHeader } from "@/components/app/app-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listPolicies, setPolicy } from "@/lib/api/access-client";
import { groupBadge, isEditable, optionLabel, policyGroupLabel, reasonMinLength } from "@/lib/policy-ui";
import type { PolicyGroup, PolicySetting, PolicyValue } from "@/types/access";

const GROUPS: PolicyGroup[] = ["A", "B", "C"];

function valueText(value: PolicyValue): string {
  if (value === true) return "فعال";
  if (value === false) return "غیرفعال";
  return String(value);
}

function PolicyRow({
  setting,
  canEdit,
  onSaved,
}: {
  setting: PolicySetting;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<PolicyValue>(setting.value);
  const [reason, setReason] = useState("");
  const action = useAction(onSaved);
  const minReason = reasonMinLength(setting.group);
  const editable = isEditable(setting.group) && canEdit;

  const save = async () => {
    const ok = await action.run(() => setPolicy(setting.key, value, reason.trim()));
    if (ok) setReason("");
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm" data-testid={`policy-row-${setting.key}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold">{setting.labelFa}</div>
          <div className="text-xs text-muted-foreground">{setting.descriptionFa}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="outline">گروه {groupBadge(setting.group)}</Badge>
          {setting.isDefault && <Badge variant="secondary">پیش‌فرض</Badge>}
        </div>
      </div>

      {!editable ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Lock className="size-4" />
          <span>{valueText(setting.value)}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {setting.type === "enum" ? (
            <select
              className={SELECT_CLASS}
              value={String(value)}
              disabled={action.busy}
              onChange={(e) => setValue(e.target.value)}
            >
              {(setting.allowed as string[]).map((option) => (
                <option key={option} value={option}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          ) : (
            <Input
              dir="ltr"
              type="number"
              value={String(value)}
              disabled={action.busy}
              onChange={(e) => setValue(e.target.value === "" ? 0 : Number(e.target.value))}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="min-w-52 flex-1"
              value={reason}
              disabled={action.busy}
              placeholder={`دلیل تغییر (حداقل ${minReason} نویسه)`}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              onClick={save}
              disabled={action.busy || reason.trim().length < minReason || value === setting.value}
            >
              ذخیره
            </Button>
          </div>
          {action.error && (
            <Alert variant="destructive">
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}

export default function PoliciesSettingsPage() {
  const { can } = useAccess();
  const policies = useLoad((signal) => listPolicies(signal));
  const canEdit = can("members", "admin");
  const items = policies.data ?? [];

  return (
    <>
      <PageHeader
        title="قواعد سازمان"
        description="قواعد ثابت (گروه الف) همیشه فعال‌اند؛ قواعد حفاظت از دفتر (ب) و قواعد مدیریتی (ج) را با دلیل تغییر دهید."
        icon={<SlidersHorizontal className="size-6 text-indigo-500" />}
      />
      {policies.error && (
        <Alert variant="destructive">
          <AlertDescription>{policies.error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4">
        {GROUPS.map((group) => {
          const rows = items.filter((setting) => setting.group === group);
          if (rows.length === 0) return null;
          return (
            <Card key={group} data-testid={`policy-group-${group}`}>
              <CardHeader>
                <CardTitle className="text-base">{policyGroupLabel(group)}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {rows.map((setting) => (
                  <PolicyRow key={setting.key} setting={setting} canEdit={canEdit} onSaved={policies.reload} />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
