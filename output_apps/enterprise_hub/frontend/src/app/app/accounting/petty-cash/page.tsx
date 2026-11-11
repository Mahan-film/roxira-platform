"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AccountingPettyCashRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/treasury/petty-cash");
  }, [router]);

  return (
    <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
      در حال انتقال به صفحه صندوق و تنخواه در خزانه‌داری...
    </div>
  );
}
