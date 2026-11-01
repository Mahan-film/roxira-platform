"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronLeft, Plus, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createAccount } from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import { buildAccountTree, countReview, visibleNodes } from "@/lib/account-tree";
import { formatMoneyRial } from "@/lib/fa-format";
import {
  ACCOUNT_TYPE_LABELS,
  AccountType,
  type ChartOfAccount,
} from "@/types/accounting";

/**
 * Chart of accounts as a tree: indented by code prefix, each row showing its
 * own balance and the roll-up of everything below it. Doubtful placements are
 * flagged, never moved.
 */
export function AccountTreeCard({
  accounts,
  onCreated,
}: {
  accounts: ChartOfAccount[];
  onCreated: () => void;
}) {
  const roots = useMemo(() => buildAccountTree(accounts), [accounts]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [codePrefill, setCodePrefill] = useState("");
  const rows = visibleNodes(roots, collapsed);
  const flagged = countReview(roots);

  function toggle(code: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>سرفصل حساب‌ها</CardTitle>
        <Button
          size="sm"
          onClick={() => {
            setCodePrefill("");
            setFormOpen((v) => !v);
          }}
          aria-expanded={formOpen}
        >
          <Plus />
          حساب جدید
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {flagged > 0 && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>{flagged.toLocaleString("fa-IR")} حساب نیاز به بررسی دارد</AlertTitle>
            <AlertDescription>
              جابه‌جایی خودکار انجام نمی‌شود؛ ردیف‌های علامت‌دار را بررسی کنید.
            </AlertDescription>
          </Alert>
        )}
        {formOpen && (
          <AddAccountForm
            key={codePrefill}
            initialCode={codePrefill}
            onDone={() => {
              setFormOpen(false);
              onCreated();
            }}
          />
        )}
      </CardContent>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>کد</TableHead>
              <TableHead>نام حساب</TableHead>
              <TableHead>نوع</TableHead>
              <TableHead>مانده</TableHead>
              <TableHead>مانده با زیرمجموعه</TableHead>
              <TableHead>
                <span className="sr-only">افزودن زیرحساب</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((node) => {
              const { account } = node;
              const hasChildren = node.children.length > 0;
              const isCollapsed = collapsed.has(account.code);
              return (
                <TableRow key={account.id}>
                  <TableCell className="font-mono text-xs">{account.code}</TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1" style={{ paddingInlineStart: `${node.depth * 1.25}rem` }}>
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => toggle(account.code)}
                          aria-label={isCollapsed ? "باز کردن" : "بستن"}
                          aria-expanded={!isCollapsed}
                          className="rounded p-0.5 hover:bg-muted"
                        >
                          {isCollapsed ? <ChevronLeft className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                      ) : (
                        <span className="inline-block size-5" aria-hidden="true" />
                      )}
                      {account.name}
                      {node.review && (
                        <Badge variant="outline" title={node.review} className="border-amber-500/50 text-amber-500">
                          <TriangleAlert className="size-3" />
                          نیاز به بررسی
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{ACCOUNT_TYPE_LABELS[account.accountType]}</TableCell>
                  <TableCell>{formatMoneyRial(account.balance)}</TableCell>
                  <TableCell className="font-semibold">{hasChildren ? formatMoneyRial(node.rollup) : "—"}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCodePrefill(account.code);
                        setFormOpen(true);
                      }}
                    >
                      <Plus />
                      زیرحساب
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function AddAccountForm({ initialCode, onDone }: { initialCode: string; onDone: () => void }) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>(AccountType.ASSET);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createAccount({ code: code.trim(), name: name.trim(), accountType });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.details.join(" | ") : "ثبت حساب انجام نشد.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="acc-code">کد</Label>
        <Input id="acc-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={32} />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="acc-name">نام حساب</Label>
        <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="acc-type">نوع</Label>
        <select
          id="acc-type"
          value={accountType}
          onChange={(e) => setAccountType(e.target.value as AccountType)}
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        >
          {Object.values(AccountType).map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="text-xs text-rose-400 sm:col-span-4">{error}</p>}
      <div className="sm:col-span-4">
        <Button type="submit" size="sm" disabled={saving || !code.trim() || !name.trim()}>
          ذخیره حساب
        </Button>
      </div>
    </form>
  );
}
