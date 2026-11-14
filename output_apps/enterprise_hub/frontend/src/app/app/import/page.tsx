"use client";

import { useState } from "react";
import { FileUp, ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/app/app-ui";
import { useAccess } from "@/components/app/access-provider";
import { BulkImportPanel } from "@/components/app/bulk-import-panel";
import { ImportDryRunPanel } from "@/components/app/import-dry-run-panel";
import { ImportWizard } from "@/components/app/import-wizard";

export default function SuiteImportPage() {
  const { can } = useAccess();
  const canRead = can("data_import", "read");
  const canCreate = can("data_import", "create");
  // Files over 5 MB picked in the wizard go to the bulk streaming import (#277).
  const [bulkFile, setBulkFile] = useState<File | null>(null);

  if (!canRead && !canCreate) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <ShieldAlert className="size-10 text-rose-500 mb-3" />
        <h2 className="text-base font-bold">دسترسی محدود شده است</h2>
        <p className="text-sm text-muted-foreground mt-1">شما مجوز دسترسی به ماژول ورود اطلاعات را ندارید.</p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="ورود از اکسل"
        description="خروجی نرم‌افزار قبلی، فایل اکسل، PDF یا عکس را رها کنید یا کل دیتابیس را یک‌جا منتقل کنید؛ مشتریان، کارکنان، کالاها و حساب‌ها خودکار ثبت می‌شوند"
        icon={<FileUp className="size-6 text-indigo-500" />}
      />
      <ImportDryRunPanel />
      <BulkImportPanel incomingFile={bulkFile} onIncomingFileUsed={() => setBulkFile(null)} />
      <h2 className="mt-10 mb-3 text-base font-bold">ورود تکی با نگاشت دستی، PDF و عکس</h2>
      <ImportWizard onBulkFile={setBulkFile} />
    </>
  );
}
