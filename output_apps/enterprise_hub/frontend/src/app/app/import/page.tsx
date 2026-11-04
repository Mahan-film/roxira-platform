"use client";

import { FileUp } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { BulkImportPanel } from "@/components/app/bulk-import-panel";
import { ImportWizard } from "@/components/app/import-wizard";

export default function SuiteImportPage() {
  return (
    <>
      <PageHeader
        title="ورود داده"
        description="خروجی نرم‌افزار قبلی، فایل اکسل، PDF یا عکس را رها کنید یا کل دیتابیس را یک‌جا منتقل کنید؛ مشتریان، کارکنان، کالاها و حساب‌ها خودکار ثبت می‌شوند"
        icon={<FileUp className="size-6 text-indigo-500" />}
      />
      <BulkImportPanel />
      <h2 className="mt-10 mb-3 text-base font-bold">ورود تکی با نگاشت دستی، PDF و عکس</h2>
      <ImportWizard />
    </>
  );
}
