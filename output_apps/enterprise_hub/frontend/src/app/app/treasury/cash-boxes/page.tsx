"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TreasuryCashBoxesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/app/money?tab=cash-boxes");
  }, [router]);

  return (
    <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
      در حال انتقال به مرکز نقد و بانک (صندوق و کارتخوان)...
    </div>
  );
}
