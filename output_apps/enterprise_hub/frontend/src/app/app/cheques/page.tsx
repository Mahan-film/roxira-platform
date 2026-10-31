"use client";

import Link from "next/link";
import { ArrowRight, Banknote } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { ChequesView } from "@/components/cheques/cheques-view";
import { buttonVariants } from "@/components/ui/button";

export default function SuiteChequesPage() {
  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="چک‌ها"
        description="چک‌های دریافتی و صادرشده، سررسیدها و ثبت خودکار سند حسابداری هر تغییر وضعیت"
        icon={<Banknote className="size-6 text-indigo-500" />}
        actions={
          <Link href="/app/accounting" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowRight aria-hidden="true" />
            حساب‌ها
          </Link>
        }
      />
      <ChequesView />
    </EnterpriseRouteGuard>
  );
}
