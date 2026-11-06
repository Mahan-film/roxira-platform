"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { BankReconWizard } from "@/components/accounting/bank/bank-recon-wizard";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { buttonVariants } from "@/components/ui/button";

export default function BankReconcilePage() {
  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="مغایرت‌گیری بانکی"
        description="صورتحساب بانک را بارگذاری کنید؛ کارمزدها خودکار شناسایی می‌شوند و فقط موارد مبهم پرسیده می‌شود."
        icon={<Sparkles className="size-6 text-indigo-500" />}
        actions={
          <Link href="/app/accounting/bank" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowRight aria-hidden="true" />
            حساب‌های بانکی
          </Link>
        }
      />
      <BankReconWizard />
    </EnterpriseRouteGuard>
  );
}
