"use client";

import Link from "next/link";
import { ArrowRight, FileUp, Landmark } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { BankReconciliation } from "@/components/accounting/bank/bank-reconciliation";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { buttonVariants } from "@/components/ui/button";

export default function SuiteBankReconciliationPage() {
  return (
    <EnterpriseRouteGuard requireAdmin>
      <PageHeader
        title="بانک و مغایرت‌گیری"
        description="حساب‌های بانکی، ورود صورتحساب بانک و تطبیق آن با دفاتر"
        icon={<Landmark className="size-6 text-indigo-500" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/accounting" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ArrowRight aria-hidden="true" />
              حساب‌ها
            </Link>
            <Link href="/app/import" className={buttonVariants({ size: "sm" })}>
              <FileUp aria-hidden="true" />
              ورود صورتحساب بانک
            </Link>
          </div>
        }
      />
      <BankReconciliation />
    </EnterpriseRouteGuard>
  );
}
