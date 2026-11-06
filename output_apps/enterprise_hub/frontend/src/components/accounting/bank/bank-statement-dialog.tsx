"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Upload } from "lucide-react";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { uploadStatement, type ReconSession } from "@/lib/api/bank-recon-client";
import { bankLabel } from "@/lib/bank-accounts-ui";
import type { BankAccount } from "@/types/banking";

const SELECT_CLASS = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm";

/** Form body; mounted only while the drawer is open, so state resets on close. */
function StatementForm({
  accounts,
  preselectedAccountId,
  onUploaded,
}: {
  accounts: BankAccount[];
  preselectedAccountId?: number;
  onUploaded?: (session: ReconSession) => void;
}) {
  const [accountId, setAccountId] = useState<number | "">(preselectedAccountId ?? accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconSession | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || accountId === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await uploadStatement(file, Number(accountId));
      setResult(session);
      onUploaded?.(session);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-600">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          صورتحساب بارگذاری شد
        </p>
        <p>
          فایل: <span className="font-medium">{result.fileName}</span>
        </p>
        <p className="text-muted-foreground">وضعیت: {result.status}</p>
        <Link
          href="/app/accounting/bank/reconcile"
          className={buttonVariants({ size: "sm", className: "w-fit" })}
        >
          ادامه مغایرت‌گیری
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-sm">
      <ErrorNotice title="بارگذاری صورتحساب ناموفق بود" message={error} />
      <label className="flex flex-col gap-1">
        <span>حساب بانکی</span>
        <select
          required
          value={accountId}
          onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
          className={SELECT_CLASS}
        >
          <option value="">انتخاب حساب بانکی</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} — {bankLabel(account.bankCode)} — {account.accountNumber}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <Label htmlFor="bank-statement-file">فایل صورتحساب</Label>
        <input
          id="bank-statement-file"
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-xs file:me-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1"
        />
      </div>
      <Button type="submit" disabled={busy || !file || accountId === ""} className="w-fit">
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
        بارگذاری صورتحساب
      </Button>
    </form>
  );
}

/** Dialog that uploads one bank statement file for a chosen bank account. */
export function BankStatementDialog({
  open,
  accounts,
  preselectedAccountId,
  onClose,
  onUploaded,
}: {
  open: boolean;
  accounts: BankAccount[];
  preselectedAccountId?: number;
  onClose: () => void;
  onUploaded?: (session: ReconSession) => void;
}) {
  return (
    <Drawer open={open} title="ورود صورتحساب بانک" size="md" onClose={onClose}>
      {open && (
        <StatementForm
          accounts={accounts}
          preselectedAccountId={preselectedAccountId}
          onUploaded={onUploaded}
        />
      )}
    </Drawer>
  );
}
