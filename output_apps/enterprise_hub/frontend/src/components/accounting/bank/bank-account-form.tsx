"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createBankAccount } from "@/lib/api/banking-client";
import { AccountType, type ChartOfAccount } from "@/types/accounting";
import { BANK_LABELS, type BankAccount, type BankCode } from "@/types/banking";

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";

/** Form for a new bank account linked to an asset ledger account (cash & bank). */
export function BankAccountForm({
  ledgerAccounts,
  onCreated,
  onCancel,
}: {
  ledgerAccounts: ChartOfAccount[];
  onCreated: (account: BankAccount) => void;
  onCancel: () => void;
}) {
  const assets = ledgerAccounts.filter((ledger) => ledger.accountType === AccountType.ASSET);
  const [name, setName] = useState("");
  const [bankCode, setBankCode] = useState<BankCode>("mellat");
  const [accountNumber, setAccountNumber] = useState("");
  const [iban, setIban] = useState("");
  const [ledgerAccountId, setLedgerAccountId] = useState<number>(assets[0]?.id ?? 0);
  const [openingBalance, setOpeningBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await createBankAccount({
        name: name.trim(),
        bankCode,
        accountNumber: accountNumber.trim(),
        iban: iban.trim() || undefined,
        ledgerAccountId,
        openingBalance: openingBalance.trim() ? Number(openingBalance.replace(/[,٬]/g, "")) : undefined,
      });
      onCreated(created);
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>حساب بانکی جدید</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <ErrorNotice title="ثبت حساب ناموفق بود" message={error} />
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span>نام حساب</span>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="جاری ملت شعبه مرکزی" />
          </label>
          <label className="flex flex-col gap-1">
            <span>بانک</span>
            <select value={bankCode} onChange={(e) => setBankCode(e.target.value as BankCode)} className={SELECT_CLASS}>
              {(Object.keys(BANK_LABELS) as BankCode[]).map((code) => (
                <option key={code} value={code}>
                  {BANK_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>شماره حساب</span>
            <Input required dir="ltr" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>شماره شبا (اختیاری)</span>
            <Input dir="ltr" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IR..." />
          </label>
          <label className="flex flex-col gap-1">
            <span>حساب دفتر کل</span>
            <select
              required
              value={ledgerAccountId}
              onChange={(e) => setLedgerAccountId(Number(e.target.value))}
              className={SELECT_CLASS}
            >
              {assets.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.code} {ledger.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>مانده بانک پیش از نخستین سطر (ریال، اختیاری)</span>
            <Input dir="ltr" inputMode="numeric" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy || !ledgerAccountId}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              ثبت حساب
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              انصراف
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
