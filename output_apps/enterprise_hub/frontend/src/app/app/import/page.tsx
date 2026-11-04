"use client";

import { useState } from "react";
import { FileUp } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { BulkImportPanel } from "@/components/app/bulk-import-panel";
import { ImportWizard } from "@/components/app/import-wizard";

export default function SuiteImportPage() {
  // Files over 40 MB picked in the wizard go to the bulk streaming import (#277).
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  return (
    <>
      <PageHeader
        title="ورود داده"
        description="خروجی نرم‌افزار قبلی، فایل اکسل، PDF یا عکس را رها کنید یا کل دیتابیس را یک‌جا منتقل کنید؛ مشتریان، کارکنان، کالاها و حساب‌ها خودکار ثبت می‌شوند"
        icon={<FileUp className="size-6 text-indigo-500" />}
      />
      <BulkImportPanel incomingFile={bulkFile} onIncomingFileUsed={() => setBulkFile(null)} />
      <h2 className="mt-10 mb-3 text-base font-bold">ورود تکی با نگاشت دستی، PDF و عکس</h2>
      <ImportWizard onBulkFile={setBulkFile} />
    </>
  );
}
