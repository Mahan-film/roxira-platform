"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { ErrorNotice, loadErrorMessage } from "@/components/app/app-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createCheque } from "@/lib/api/cheques-client";
import { isValidNationalId, isValidSayadNumber, toLatinDigits } from "@/lib/cheques-ui";
import { isoToJalaliInput, jalaliToIso } from "@/lib/jalali";
import {
  SAYAD_REGISTRATION_LABELS,
  type Cheque,
  type ChequeDirection,
  type SayadRegistrationStatus,
} from "@/types/cheques";

const SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm";
const todayIso = () => new Date().toISOString().slice(0, 10);

export function ChequeForm({ onCreated, onCancel }: { onCreated: (cheque: Cheque) => void; onCancel: () => void }) {
  const [direction, setDirection] = useState<ChequeDirection>("received");
  const [sayad, setSayad] = useState("");
  const [sayadVerified, setSayadVerified] = useState(false);
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [amount, setAmount] = useState("");
  const [issue, setIssue] = useState(() => isoToJalaliInput(todayIso()));
  const [due, setDue] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyCode, setPartyCode] = useState("");
  const [registration, setRegistration] = useState<SayadRegistrationStatus>("unknown");
  const [receiverId, setReceiverId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const issueDate = jalaliToIso(issue);
    const dueDate = jalaliToIso(due);
    if (!issueDate || !dueDate) {
      setError("تاریخ صدور و سررسید را شمسی و به شکل ۱۴۰۵/۰۸/۱۰ وارد کنید.");
      return;
    }
    const sayadNumber = toLatinDigits(sayad).replace(/\s/g, "");
    if (sayadNumber && !isValidSayadNumber(sayadNumber)) {
      setError("شناسه صیاد باید ۱۶ رقم و نه یک رقم تکراری باشد.");
      return;
    }
    const receiverNationalId = toLatinDigits(receiverId).replace(/\s/g, "");
    if (receiverNationalId && !isValidNationalId(receiverNationalId)) {
      setError("کد ملی (۱۰ رقم) یا شناسه ملی (۱۱ رقم) دریافت‌کننده معتبر نیست.");
      return;
    }
    const amountText = toLatinDigits(amount).replace(/[,٬\s]/g, "");
    if (!/^\d{1,16}(\.\d{1,2})?$/.test(amountText) || Number(amountText) <= 0) {
      setError("مبلغ باید عددی بزرگ‌تر از صفر با حداکثر دو رقم اعشار باشد.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await createCheque({
          direction,
          sayadNumber: sayadNumber || undefined,
          sayadVerified: sayadNumber ? sayadVerified : undefined,
          chequeNumber: toLatinDigits(chequeNumber).trim(),
          sayadRegistrationStatus: registration,
          receiverNationalId: receiverNationalId || undefined,
          bankName: bankName.trim() || undefined,
          amount: amountText,
          issueDate,
          dueDate,
          partyName: partyName.trim(),
          partyCode: partyCode.trim() || undefined,
        }),
      );
    } catch (err) {
      setError(loadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>چک جدید</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ErrorNotice title="ثبت چک ناموفق بود" message={error} />
          </div>
          <label className="flex flex-col gap-1">
            <span>نوع چک</span>
            <select value={direction} onChange={(e) => setDirection(e.target.value as ChequeDirection)} className={SELECT_CLASS}>
              <option value="received">دریافتی از مشتری</option>
              <option value="issued">صادرشده به تأمین‌کننده</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{direction === "received" ? "صادرکننده (مشتری)" : "ذی‌نفع"}</span>
            <Input required value={partyName} onChange={(e) => setPartyName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>شناسه صیاد (۱۶ رقم، اختیاری)</span>
            <Input dir="ltr" inputMode="numeric" value={sayad} onChange={(e) => setSayad(e.target.value)} placeholder="1234567890123456" />
          </label>
          <label className="flex items-end gap-2 pb-1">
            <input type="checkbox" checked={sayadVerified} onChange={(e) => setSayadVerified(e.target.checked)} />
            <span>در سامانه صیاد ثبت/تأیید شده است (اعلام شما؛ بررسی خودکار انجام نمی‌شود)</span>
          </label>
          <label className="flex flex-col gap-1">
            <span>وضعیت ثبت در صیاد (اعلام شما)</span>
            <select value={registration} onChange={(e) => setRegistration(e.target.value as SayadRegistrationStatus)} className={SELECT_CLASS}>
              {(Object.keys(SAYAD_REGISTRATION_LABELS) as SayadRegistrationStatus[]).map((k) => (
                <option key={k} value={k}>
                  {SAYAD_REGISTRATION_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>کد ملی / شناسه ملی دریافت‌کننده (اختیاری)</span>
            <Input dir="ltr" inputMode="numeric" value={receiverId} onChange={(e) => setReceiverId(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>شماره سری چک</span>
            <Input required dir="ltr" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>بانک</span>
            <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>مبلغ (ریال)</span>
            <Input required dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>کد طرف حساب (اختیاری)</span>
            <Input dir="ltr" value={partyCode} onChange={(e) => setPartyCode(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span>تاریخ صدور (شمسی)</span>
            <Input required dir="ltr" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="1405/08/10" />
          </label>
          <label className="flex flex-col gap-1">
            <span>تاریخ سررسید (شمسی)</span>
            <Input required dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} placeholder="1405/10/10" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              ثبت چک و سند حسابداری
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              انصراف
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

