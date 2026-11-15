"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Banknote,
  FileUp,
  Landmark,
  Scale,
  Sparkles,
  Vault,
  Wallet,
} from "lucide-react";

import { LoadingLine, PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { BankAccountsList } from "@/components/accounting/bank/bank-accounts-list";
import { BankReconWizard } from "@/components/accounting/bank/bank-recon-wizard";
import { BankReconciliation } from "@/components/accounting/bank/bank-reconciliation";
import { BankStatementDialog } from "@/components/accounting/bank/bank-statement-dialog";
import { CashBoxesView } from "@/components/treasury/cash-boxes-view";
import { PettyCashView } from "@/components/treasury/petty-cash-view";
import { ChequesView } from "@/components/cheques/cheques-view";
import { DamageCalculatorSection } from "@/components/damages/damage-calculator-section";
import { DamageHistoryTable } from "@/components/damages/damage-history-table";
import { Button } from "@/components/ui/button";
import {
  MONEY_TABS,
  resolveMoneyTab,
  type MoneyTabKey,
} from "@/lib/money-hub";
import type { BankAccount } from "@/types/banking";

const TAB_ICONS: Record<MoneyTabKey, typeof Landmark> = {
  bank: Landmark,
  reconcile: Sparkles,
  "cash-boxes": Vault,
  "petty-cash": Wallet,
  cheques: Banknote,
  damages: Scale,
};

function BankTabContent() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [preselectedAccountId, setPreselectedAccountId] = useState<number | undefined>(undefined);
  const [listKey, setListKey] = useState(0);

  const onAccountsLoaded = useCallback((list: BankAccount[]) => setAccounts(list), []);

  const openStatementDialog = useCallback((accountId?: number) => {
    setPreselectedAccountId(accountId);
    setDialogOpen(true);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={() => openStatementDialog()}
          variant="outline"
          size="sm"
        >
          <FileUp aria-hidden="true" className="size-4 ml-1.5" />
          ورود صورتحساب بانکی
        </Button>
      </div>

      <BankAccountsList
        key={listKey}
        onAccountsLoaded={onAccountsLoaded}
        onOpenStatement={openStatementDialog}
      />

      <BankStatementDialog
        open={dialogOpen}
        accounts={accounts}
        preselectedAccountId={preselectedAccountId}
        onClose={() => setDialogOpen(false)}
        onUploaded={() => setListKey((key) => key + 1)}
      />
    </div>
  );
}

function ReconcileTabContent() {
  const [mode, setMode] = useState<"wizard" | "matching">("wizard");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-3">
        <div className="text-sm text-muted-foreground">
          {mode === "wizard"
            ? "صورتحساب بانک را بارگذاری کنید؛ هوش مصنوعی کارمزدها را شناسایی و مغایرت‌ها را تطبیق می‌دهد."
            : "تطبیق دستی ردیف‌های صورتحساب با ردیف‌های دفاتر حسابداری"}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "wizard" ? "default" : "outline"}
            onClick={() => setMode("wizard")}
          >
            <Sparkles className="size-4 ml-1.5" />
            ویزارد مغایرت‌گیری
          </Button>
          <Button
            size="sm"
            variant={mode === "matching" ? "default" : "outline"}
            onClick={() => setMode("matching")}
          >
            تطبیق دفاتر و صورتحساب
          </Button>
        </div>
      </div>

      {mode === "wizard" ? <BankReconWizard /> : <BankReconciliation />}
    </div>
  );
}

function DamagesTabContent() {
  return (
    <div className="space-y-8">
      <DamageCalculatorSection />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">سوابق محاسبات</h2>
        <DamageHistoryTable />
      </section>
    </div>
  );
}

function MoneyHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = resolveMoneyTab(searchParams?.get("tab"));

  const handleSelectTab = (tab: MoneyTabKey) => {
    router.replace(`/app/money?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="مرکز نقد و بانک"
        description="مدیریت یکپارچه حساب‌های بانکی، مغایرت‌گیری، صندوق، تنخواه‌گردان، چک‌ها و محاسبات خسارت تأخیر تأدیه"
        icon={<Landmark className="size-6 text-indigo-500" />}
      />

      <div
        role="tablist"
        aria-label="بخش‌های مرکز نقد و بانک"
        className="flex flex-wrap gap-2 border-b pb-2"
      >
        {MONEY_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.key];
          const isSelected = activeTab === tab.key;
          return (
            <Button
              key={tab.key}
              role="tab"
              aria-selected={isSelected}
              variant={isSelected ? "default" : "ghost"}
              size="sm"
              onClick={() => handleSelectTab(tab.key)}
              className="gap-2"
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{tab.label}</span>
            </Button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={MONEY_TABS.find((t) => t.key === activeTab)?.label} className="mt-4">
        {activeTab === "bank" && <BankTabContent />}
        {activeTab === "reconcile" && <ReconcileTabContent />}
        {activeTab === "cash-boxes" && <CashBoxesView />}
        {activeTab === "petty-cash" && <PettyCashView />}
        {activeTab === "cheques" && <ChequesView />}
        {activeTab === "damages" && <DamagesTabContent />}
      </div>
    </div>
  );
}

export default function MoneyHubPage() {
  return (
    <EnterpriseRouteGuard>
      <Suspense fallback={<LoadingLine message="در حال بارگذاری مرکز نقد و بانک..." />}>
        <MoneyHubContent />
      </Suspense>
    </EnterpriseRouteGuard>
  );
}
