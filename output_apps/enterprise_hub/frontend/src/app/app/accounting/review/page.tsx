"use client";

import Link from "next/link";
import { BookOpenCheck, ListTree, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/app/app-ui";
import { AccountReview } from "@/components/accounting/account-review";
import { EnterpriseRouteGuard } from "@/components/auth/enterprise-route-guard";
import { buttonVariants } from "@/components/ui/button";

export default function AccountReviewPage() {
  return (
    <EnterpriseRouteGuard>
      <PageHeader
        title="مرور حساب‌ها"
        description="مرور چندسطحی حساب‌ها از تراز آزمایشی به کل، معین، تفصیلی و گردش اسناد با مانده جاری"
        icon={<ListTree className="size-6 text-indigo-500" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/app/accounting/vouchers"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ReceiptText aria-hidden="true" className="size-4" />
              اسناد حسابداری
            </Link>
            <Link
              href="/app/accounting/chart"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <BookOpenCheck aria-hidden="true" className="size-4" />
              درخت حساب‌ها
            </Link>
          </div>
        }
      />

      <AccountReview />
    </EnterpriseRouteGuard>
  );
}
