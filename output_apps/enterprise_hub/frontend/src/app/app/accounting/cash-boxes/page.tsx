"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, CreditCard, Landmark, Plus, RefreshCw, Vault } from "lucide-react";

import { ErrorNotice, LoadingLine, PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { JalaliDateInput } from "@/components/ui/jalali-date-input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatJalaliDate, formatMoneyRial, formatNumber } from "@/lib/fa-format";
import {
  createCashBox,
  listBankAccounts,
  listCashBoxes,
  settlePos,
  transferCashBank,
} from "@/lib/api/banking-client";
import type {
  BankAccount,
  CashBankTransferDto,
  CashBox,
  CreateCashBoxDto,
  PosSettlementDto,
} from "@/types/banking";

export default function CashBoxesPage() {
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal states
  const [createDialogOpen, setCreateDialogOpen] = useState<boolean>(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState<boolean>(false);
  const [posDialogOpen, setPosDialogOpen] = useState<boolean>(false);

  // Form states
  const [newBoxName, setNewBoxName] = useState("");
  const [newBoxCode, setNewBoxCode] = useState("");
  const [newBoxAccountId, setNewBoxAccountId] = useState("");
  const [newBoxOpening, setNewBoxOpening] = useState("0");

  const [transferBoxId, setTransferBoxId] = useState<number | "">("");
  const [transferBankId, setTransferBankId] = useState<number | "">("");
  const [transferAmount, setTransferAmount] = useState<string>("");
  const [transferDirection, setTransferDirection] = useState<"CASH_TO_BANK" | "BANK_TO_CASH">("CASH_TO_BANK");
  const [transferDate, setTransferDate] = useState<string>("");
  const [transferDesc, setTransferDesc] = useState<string>("");

  const [posBankId, setPosBankId] = useState<number | "">("");
  const [posTerminal, setPosTerminal] = useState<string>("");
  const [posGross, setPosGross] = useState<string>("");
  const [posFee, setPosFee] = useState<string>("0");
  const [posDate, setPosDate] = useState<string>("");
  const [posRef, setPosRef] = useState<string>("");

  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([listCashBoxes(), listBankAccounts()])
      .then(([boxes, banks]) => {
        setCashBoxes(boxes);
        setBankAccounts(banks);
        if (boxes.length > 0 && transferBoxId === "") {
          setTransferBoxId(boxes[0].id);
        }
        if (banks.length > 0 && transferBankId === "") {
          setTransferBankId(banks[0].id);
          setPosBankId(banks[0].id);
        }
      })
      .catch((err) => setError(err.message || "خطا در بارگذاری صندوق‌ها و بانک‌ها"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateCashBox = async () => {
    if (!newBoxName || !newBoxCode || !newBoxAccountId) {
      setError("لطفاً نام، کد صندوق و شناسه حساب معین را وارد کنید.");
      return;
    }
    setActionLoading(true);
    try {
      await createCashBox({
        name: newBoxName,
        code: newBoxCode,
        ledgerAccountId: Number(newBoxAccountId),
        openingBalance: Number(newBoxOpening) || 0,
      });
      setSuccessMsg("صندوق جدید با موفقیت ایجاد شد.");
      setCreateDialogOpen(false);
      setNewBoxName("");
      setNewBoxCode("");
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ایجاد صندوق");
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferBoxId || !transferBankId || !transferAmount || !transferDate) {
      setError("لطفاً تمام اطلاعات انتقال وجه را تکمیل کنید.");
      return;
    }
    setActionLoading(true);
    try {
      const res = await transferCashBank({
        cashBoxId: Number(transferBoxId),
        bankAccountId: Number(transferBankId),
        amount: Number(transferAmount),
        direction: transferDirection,
        date: transferDate,
        description: transferDesc || undefined,
      });
      setSuccessMsg(`انتقال وجه انجام شد و سند شماره ${res.voucher.entryNumber} ثبت گردید.`);
      setTransferDialogOpen(false);
      setTransferAmount("");
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در انتقال وجه");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePosSettlement = async () => {
    if (!posBankId || !posTerminal || !posGross || !posDate) {
      setError("لطفاً حساب بانک، شماره پایانه، مبلغ ناخالص و تاریخ را وارد کنید.");
      return;
    }
    setActionLoading(true);
    try {
      const res = await settlePos({
        bankAccountId: Number(posBankId),
        terminalNumber: posTerminal,
        date: posDate,
        grossAmount: posGross,
        feeAmount: posFee || "0",
        referenceNumber: posRef || undefined,
      });
      setSuccessMsg(`تسویه کارت‌خوان ثبت شد و سند حسابداری شماره ${res.voucher.entryNumber} صادر شد.`);
      setPosDialogOpen(false);
      setPosGross("");
      setPosFee("0");
      setPosTerminal("");
      loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "خطا در ثبت تسویه کارت‌خوان");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="صندوق‌ها و پایانه‌های فروش (POS)"
        description="مدیریت صندوق‌های نقدی، انتقال وجه بین صندوق و بانک، و تسویه تراکنش‌های کارت‌خوان همراه با کسر کارمزد"
        icon={<Vault className="size-6 text-amber-600" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/app/accounting/bank"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="size-4" />
              حساب‌های بانکی
            </Link>
            <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="size-4 ml-1.5" />
              صندوق جدید
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTransferDialogOpen(true)}
              disabled={cashBoxes.length === 0 || bankAccounts.length === 0}
            >
              <ArrowLeftRight className="size-4 ml-1.5" />
              انتقال نقد و بانک
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPosDialogOpen(true)}
              disabled={bankAccounts.length === 0}
            >
              <CreditCard className="size-4 ml-1.5" />
              تسویه کارت‌خوان (POS)
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {error && <ErrorNotice title="خطا در عملیات صندوق" message={error} />}
        {successMsg && (
          <div className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200">
            {successMsg}
          </div>
        )}
        <LoadingLine show={loading} />

        {/* Cash Boxes List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>فهرست صندوق‌های سازمان ({cashBoxes.length})</span>
              <Button variant="ghost" size="sm" onClick={loadData}>
                <RefreshCw className="size-4 ml-1.5" />
                تازه‌سازی
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cashBoxes.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Vault className="size-12 mx-auto mb-3 opacity-40" />
                <p>هیچ صندوقی برای این سازمان تعریف نشده است.</p>
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  ایجاد اولین صندوق
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24 text-right">کد صندوق</TableHead>
                      <TableHead className="text-right">عنوان صندوق</TableHead>
                      <TableHead className="w-32 text-center">وضعیت</TableHead>
                      <TableHead className="w-44 text-left font-mono">موجودی اولیه (ریال)</TableHead>
                      <TableHead className="w-44 text-left font-mono">موجودی فعلی (ریال)</TableHead>
                      <TableHead className="w-36 text-center">تاریخ ایجاد</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashBoxes.map((box: CashBox) => (
                      <TableRow key={box.id}>
                        <TableCell className="font-mono text-sm font-semibold">{box.code}</TableCell>
                        <TableCell className="font-medium">{box.name}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={box.status === "ACTIVE" || box.active ? "default" : "secondary"}>
                            {box.status === "ACTIVE" || box.active ? "فعال" : "غیرفعال"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-left font-mono">
                          {formatMoneyRial(box.openingBalance)}
                        </TableCell>
                        <TableCell className="text-left font-mono font-bold text-foreground">
                          {formatMoneyRial(box.currentBalance ?? 0)}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {formatJalaliDate(box.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Drawer: Create Cash Box */}
      <Drawer
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="ایجاد صندوق جدید"
        size="md"
      >
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="box-code">کد صندوق (مانند BOX-01)</Label>
            <Input
              id="box-code"
              value={newBoxCode}
              onChange={(e) => setNewBoxCode(e.target.value)}
              placeholder="BOX-01"
            />
          </div>
          <div>
            <Label htmlFor="box-name">عنوان صندوق</Label>
            <Input
              id="box-name"
              value={newBoxName}
              onChange={(e) => setNewBoxName(e.target.value)}
              placeholder="صندوق مرکزی"
            />
          </div>
          <div>
            <Label htmlFor="box-account">شناسه حساب دفتر کل (حساب معین صندوق)</Label>
            <Input
              id="box-account"
              type="number"
              value={newBoxAccountId}
              onChange={(e) => setNewBoxAccountId(e.target.value)}
              placeholder="شناسه حساب (مانند حساب 1011)"
            />
          </div>
          <div>
            <Label htmlFor="box-opening">موجودی اولیه (ریال)</Label>
            <Input
              id="box-opening"
              type="number"
              value={newBoxOpening}
              onChange={(e) => setNewBoxOpening(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>
              انصراف
            </Button>
            <Button onClick={handleCreateCashBox} disabled={actionLoading}>
              {actionLoading ? "در حال ایجاد..." : "ثبت صندوق"}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* Drawer: Transfer Cash and Bank */}
      <Drawer
        open={transferDialogOpen}
        onClose={() => setTransferDialogOpen(false)}
        title="انتقال وجه بین صندوق و بانک"
        size="md"
      >
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="transfer-direction">جهت انتقال</Label>
            <select
              id="transfer-direction"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={transferDirection}
              onChange={(e) =>
                setTransferDirection(e.target.value as "CASH_TO_BANK" | "BANK_TO_CASH")
              }
            >
              <option value="CASH_TO_BANK">واریز از صندوق به بانک (برداشت از صندوق)</option>
              <option value="BANK_TO_CASH">برداشت از بانک به صندوق (شارژ صندوق)</option>
            </select>
          </div>
          <div>
            <Label htmlFor="transfer-box">صندوق</Label>
            <select
              id="transfer-box"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={transferBoxId}
              onChange={(e) => setTransferBoxId(Number(e.target.value))}
            >
              {cashBoxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name} ({box.code}) - موجودی: {formatMoneyRial(box.currentBalance ?? 0)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="transfer-bank">حساب بانکی</Label>
            <select
              id="transfer-bank"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={transferBankId}
              onChange={(e) => setTransferBankId(Number(e.target.value))}
            >
              {bankAccounts.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name} ({bank.accountNumber})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="transfer-amount">مبلغ انتقال (ریال)</Label>
            <Input
              id="transfer-amount"
              type="number"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder="10000000"
            />
          </div>
          <div>
            <Label htmlFor="transfer-date">تاریخ سند</Label>
            <JalaliDateInput
              id="transfer-date"
              value={transferDate}
              onChange={(val) => setTransferDate(val || "")}
            />
          </div>
          <div>
            <Label htmlFor="transfer-desc">شرح انتقال</Label>
            <Input
              id="transfer-desc"
              value={transferDesc}
              onChange={(e) => setTransferDesc(e.target.value)}
              placeholder="واریز نقد به حساب ملت"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setTransferDialogOpen(false)}>
              انصراف
            </Button>
            <Button onClick={handleTransfer} disabled={actionLoading}>
              {actionLoading ? "در حال ثبت..." : "ثبت انتقال و صدور سند"}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* Drawer: POS Settlement */}
      <Drawer
        open={posDialogOpen}
        onClose={() => setPosDialogOpen(false)}
        title="تسویه پایانه کارت‌خوان (POS)"
        size="md"
      >
        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="pos-bank">حساب بانکی مقصد واریز</Label>
            <select
              id="pos-bank"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={posBankId}
              onChange={(e) => setPosBankId(Number(e.target.value))}
            >
              {bankAccounts.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name} ({bank.accountNumber})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="pos-terminal">شماره پایانه کارت‌خوان (Terminal ID)</Label>
            <Input
              id="pos-terminal"
              value={posTerminal}
              onChange={(e) => setPosTerminal(e.target.value)}
              placeholder="TERM-9801"
            />
          </div>
          <div>
            <Label htmlFor="pos-gross">مبلغ ناخالص تراکنش‌های کارت‌خوان (ریال)</Label>
            <Input
              id="pos-gross"
              type="number"
              value={posGross}
              onChange={(e) => setPosGross(e.target.value)}
              placeholder="10000000"
            />
          </div>
          <div>
            <Label htmlFor="pos-fee">کارمزد خدمات بانکی کسرشده (ریال)</Label>
            <Input
              id="pos-fee"
              type="number"
              value={posFee}
              onChange={(e) => setPosFee(e.target.value)}
              placeholder="12000"
            />
          </div>
          {posGross && (
            <div className="rounded-md bg-muted p-3 text-sm flex justify-between items-center">
              <span>واریز خالص به بانک:</span>
              <span className="font-mono font-bold text-blue-600">
                {formatMoneyRial(Math.max(0, Number(posGross) - Number(posFee || 0)))}
              </span>
            </div>
          )}
          <div>
            <Label htmlFor="pos-date">تاریخ تسویه</Label>
            <JalaliDateInput
              id="pos-date"
              value={posDate}
              onChange={(val) => setPosDate(val || "")}
            />
          </div>
          <div>
            <Label htmlFor="pos-ref">شماره مرجع / پیگیری شاپرک</Label>
            <Input
              id="pos-ref"
              value={posRef}
              onChange={(e) => setPosRef(e.target.value)}
              placeholder="REF-123456"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={() => setPosDialogOpen(false)}>
              انصراف
            </Button>
            <Button onClick={handlePosSettlement} disabled={actionLoading}>
              {actionLoading ? "در حال ثبت..." : "ثبت تسویه و صدور سند"}
            </Button>
          </div>
        </div>
      </Drawer>
    </EnterpriseRouteGuard>
  );
}
