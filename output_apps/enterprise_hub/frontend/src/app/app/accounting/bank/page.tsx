"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileUp, Landmark, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { BankAccountsList } from "@/components/accounting/bank/bank-accounts-list";
import { BankReconciliation } from "@/components/accounting/bank/bank-reconciliation";
import { BankStatementDialog } from "@/components/accounting/bank/bank-statement-dialog";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { buttonVariants } from "@/components/ui/button";
import type { BankAccount } from "@/types/banking";

export default function SuiteBankReconciliationPage() {
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
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="حساب‌های بانکی"
        description="موجودی هر حساب بانکی، تعداد ردیف‌های مغایرت‌نشده و تاریخ آخرین صورتحساب"
        icon={<Landmark className="size-6 text-indigo-500" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/accounting" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ArrowRight aria-hidden="true" />
              حساب‌ها
            </Link>
            <Link href="/app/accounting/bank/reconcile" className={buttonVariants({ size: "sm" })}>
              <Sparkles aria-hidden="true" />
              مغایرت‌گیری بانکی
            </Link>
            <button
              type="button"
              onClick={() => openStatementDialog()}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <FileUp aria-hidden="true" />
              ورود صورتحساب
            </button>
          </div>
        }
      />
      <BankAccountsList
        key={listKey}
        onAccountsLoaded={onAccountsLoaded}
        onOpenStatement={openStatementDialog}
      />
      <BankReconciliation />
      <BankStatementDialog
        open={dialogOpen}
        accounts={accounts}
        preselectedAccountId={preselectedAccountId}
        onClose={() => setDialogOpen(false)}
        onUploaded={() => setListKey((key) => key + 1)}
      />
    </EnterpriseRouteGuard>
  );
}
