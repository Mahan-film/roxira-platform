"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  MessageSquare,
  RefreshCw,
  Send,
  XCircle,
} from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
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
import { formatMoneyRial } from "@/lib/fa-format";
import {
  captureBankSms,
  confirmTreasurySmsDraft,
  listTreasurySmsDrafts,
  parseBankSms,
  rejectTreasurySmsDraft,
} from "@/lib/api/treasury-client";
import { listBankAccounts } from "@/lib/api/banking-client";
import type { BankAccount } from "@/types/banking";
import type { ParsedBankSms, TreasurySmsDraft } from "@/types/treasury";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function digitsOnly(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/\D/g, "");
}

/** The bank account whose number ends with the SMS account tail (only when exactly one matches). */
function matchAccountByTail(accounts: BankAccount[], tail?: string | null): number | undefined {
  const t = tail ? digitsOnly(tail) : "";
  if (!t) return undefined;
  const hits = accounts.filter((a) => digitsOnly(a.accountNumber).endsWith(t));
  return hits.length === 1 ? hits[0].id : undefined;
}

export default function TreasurySmsPage() {
  const [drafts, setDrafts] = useState<TreasurySmsDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form input
  const [smsText, setSmsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parsePreview, setParsePreview] = useState<ParsedBankSms | null>(null);

  // Confirm modal state
  const [confirmDraftItem, setConfirmDraftItem] = useState<TreasurySmsDraft | null>(null);
  const [partyCode, setPartyCode] = useState("");
  const [partyName, setPartyName] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [confirming, setConfirming] = useState(false);

  const fetchDrafts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTreasurySmsDrafts();
      setDrafts(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [draftRows, accountRows] = await Promise.all([
          listTreasurySmsDrafts(),
          listBankAccounts(),
        ]);
        if (active) {
          setDrafts(draftRows);
          setBankAccounts(accountRows);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handlePreview = async () => {
    if (!smsText.trim()) return;
    setError(null);
    try {
      const res = await parseBankSms(smsText);
      setParsePreview(res);
    } catch (err) {
      setError(`خطای تحلیل پیامک: ${(err as Error).message}`);
    }
  };

  const handleCapture = async () => {
    if (!smsText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await captureBankSms(smsText);
      setSmsText("");
      setParsePreview(null);
      await fetchDrafts();
    } catch (err) {
      setError(`خطای ثبت پیش‌نویس: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmDraftItem || !partyCode.trim() || !partyName.trim() || !bankAccountId) return;
    setConfirming(true);
    setError(null);
    try {
      await confirmTreasurySmsDraft(confirmDraftItem.id, {
        partyCode: partyCode.trim(),
        partyName: partyName.trim(),
        bankAccountId: Number(bankAccountId),
      });
      setConfirmDraftItem(null);
      setPartyCode("");
      setPartyName("");
      setBankAccountId("");
      await fetchDrafts();
    } catch (err) {
      setError(`خطای تأیید سند: ${(err as Error).message}`);
    } finally {
      setConfirming(false);
    }
  };

  const handleReject = async (id: string) => {
    setError(null);
    try {
      await rejectTreasurySmsDraft(id);
      await fetchDrafts();
    } catch (err) {
      setError(`خطای رد پیش‌نویس: ${(err as Error).message}`);
    }
  };

  return (
    <EnterpriseRouteGuard>
      <div className="space-y-6 p-6">
        <PageHeader
          title="دریافت و پرداخت از پیامک بانک"
          description="استخراج هوشمند تراکنش‌های پیامک بانک‌های معتبر کشور و صدور اسناد دریافت و پرداخت خزانه"
          actions={
            <div className="flex items-center gap-2">
              <Link
                href="/app/treasury"
                className="inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
              >
                <ArrowRight className="ml-1 h-4 w-4" />
                بازگشت به خزانه
              </Link>
              <Button variant="outline" size="sm" onClick={fetchDrafts} disabled={loading}>
                <RefreshCw className={`ml-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                تازه‌سازی
              </Button>
            </div>
          }
        />

        {error && <ErrorNotice title="خطا در عملیات پیامک بانک" message={error} />}

        {/* SMS Input Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              ورود متن پیامک بانکی
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="smsText" className="text-sm font-medium">
                متن پیامک ارسالی از بانک (ملی، ملت، صادرات، تجارت، سامان، پاسارگاد، پارسیان، سپه)
              </Label>
              <textarea
                id="smsText"
                rows={4}
                className="w-full mt-1.5 p-3 rounded-md border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="متن پیامک تراکنش واریز یا برداشت را اینجا الصاق فرمایید..."
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreview}
                disabled={!smsText.trim() || submitting}
              >
                پیش‌نمایش استخراج
              </Button>
              <Button
                size="sm"
                onClick={handleCapture}
                disabled={!smsText.trim() || submitting}
              >
                <Send className="ml-1.5 h-4 w-4" />
                {submitting ? "در حال ثبت..." : "ثبت پیش‌نویس خزانه"}
              </Button>
            </div>

            {/* Preview Box */}
            {parsePreview && (
              <div className="p-4 rounded-lg bg-muted border space-y-2 text-sm">
                <div className="font-semibold text-primary">اطلاعات شناسایی‌شده از پیامک:</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <span className="text-muted-foreground">بانک: </span>
                    <span className="font-medium">{parsePreview.bankNameFa}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">نوع تراکنش: </span>
                    <Badge variant={parsePreview.direction === "deposit" ? "default" : "secondary"}>
                      {parsePreview.direction === "deposit" ? "واریز (رسید دریافت)" : "برداشت (رسید پرداخت)"}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">مبلغ: </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      {formatMoneyRial(parsePreview.amount)}
                    </span>
                  </div>
                  {parsePreview.balance && (
                    <div>
                      <span className="text-muted-foreground">مانده: </span>
                      <span>{formatMoneyRial(parsePreview.balance)}</span>
                    </div>
                  )}
                  {parsePreview.accountTail && (
                    <div>
                      <span className="text-muted-foreground">انتهای حساب: </span>
                      <span className="font-mono">...{parsePreview.accountTail}</span>
                    </div>
                  )}
                  {parsePreview.cardTail && (
                    <div>
                      <span className="text-muted-foreground">انتهای کارت: </span>
                      <span className="font-mono">...{parsePreview.cardTail}</span>
                    </div>
                  )}
                  {parsePreview.dateTime && (
                    <div>
                      <span className="text-muted-foreground">تاریخ: </span>
                      <span className="font-mono text-xs">{parsePreview.dateTime.slice(0, 10)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Drafts List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>پیش‌نویس‌های پیامک بانکی ({drafts.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <LoadingLine show />
            ) : drafts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                هنوز هیچ پیامک بانکی ثبت نشده است. متن پیامک را الصاق فرمایید.
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>بانک</TableHead>
                      <TableHead>نوع</TableHead>
                      <TableHead>مبلغ (ریال)</TableHead>
                      <TableHead>حساب / کارت</TableHead>
                      <TableHead>وضعیت</TableHead>
                      <TableHead>عملیات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drafts.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{d.bankNameFa}</TableCell>
                        <TableCell>
                          <Badge variant={d.docKind === "receipt" ? "default" : "secondary"}>
                            {d.docKind === "receipt" ? "دریافت" : "پرداخت"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-bold">
                          {formatMoneyRial(d.amount)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.accountTail ? `حساب ...${d.accountTail}` : d.cardTail ? `کارت ...${d.cardTail}` : "-"}
                        </TableCell>
                        <TableCell>
                          {d.status === "draft" && (
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              <Clock className="w-3 h-3 ml-1" />
                              پیش‌نویس
                            </Badge>
                          )}
                          {d.status === "confirmed" && (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                              <CheckCircle className="w-3 h-3 ml-1" />
                              صادر شده
                            </Badge>
                          )}
                          {d.status === "rejected" && (
                            <Badge variant="outline" className="text-rose-600 border-rose-300">
                              <XCircle className="w-3 h-3 ml-1" />
                              رد شده
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {d.status === "draft" && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => {
                                  setConfirmDraftItem(d);
                                  setPartyCode("");
                                  setPartyName("");
                                  const match = matchAccountByTail(bankAccounts, d.accountTail);
                                  setBankAccountId(match ? String(match) : "");
                                }}
                              >
                                تأیید و صدور سند
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-600"
                                onClick={() => handleReject(d.id)}
                              >
                                رد
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Confirmation Modal */}
        {confirmDraftItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
            <Card className="w-full max-w-md shadow-lg border">
              <CardHeader>
                <CardTitle className="text-base">
                  صدور قطعی سند خزانه از پیامک {confirmDraftItem.bankNameFa}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleConfirm} className="space-y-4">
                  <div className="p-3 rounded-md bg-muted text-sm space-y-1">
                    <div>
                      <span className="text-muted-foreground">نوع: </span>
                      <span className="font-medium">
                        {confirmDraftItem.docKind === "receipt" ? "رسید دریافت" : "رسید پرداخت"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">مبلغ: </span>
                      <span className="font-bold text-emerald-600">
                        {formatMoneyRial(confirmDraftItem.amount)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="partyCode">کد طرف حساب *</Label>
                    <Input
                      id="partyCode"
                      className="mt-1"
                      placeholder="مثلاً CUST-01 یا 102001"
                      value={partyCode}
                      onChange={(e) => setPartyCode(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="partyName">نام طرف حساب *</Label>
                    <Input
                      id="partyName"
                      className="mt-1"
                      placeholder="نام شخص یا شرکت طرف حساب"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <Label htmlFor="bankAccountId">حساب بانکی *</Label>
                    <select
                      id="bankAccountId"
                      className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      required
                    >
                      <option value="">انتخاب حساب بانکی...</option>
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.accountNumber})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmDraftItem(null)}
                      disabled={confirming}
                    >
                      انصراف
                    </Button>
                    <Button type="submit" disabled={confirming || !partyCode || !partyName || !bankAccountId}>
                      {confirming ? "در حال صدور..." : "تأیید و صدور سند"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </EnterpriseRouteGuard>
  );
}
