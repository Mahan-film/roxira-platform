"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";

import { isDatabaseFile, useImportHandoff } from "@/components/app/import-handoff";

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return Boolean(types && Array.from(types).includes("Files"));
}

/**
 * Full-screen «فایل را رها کنید» overlay shown while a file is dragged over any
 * /app page. On drop it hands the file to the import wizard (database files to
 * the whole-database tab, everything else to the file tab) and routes there.
 */
export function DropOverlay() {
  const router = useRouter();
  const { setPendingFile, setPendingTab } = useImportHandoff();
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event) && depth === 0) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // A local drop zone (e.g. the import wizard) already handled this drop.
      if (event.defaultPrevented) return;
      event.preventDefault();
      depth = 0;
      setActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      setPendingFile(file);
      setPendingTab(isDatabaseFile(file) ? "package" : "file");
      router.push("/app/import");
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [router, setPendingFile, setPendingTab]);

  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur"
      aria-hidden="true"
    >
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-indigo-400 bg-indigo-500/10 px-10 py-12 text-center">
        <FileUp className="size-12 text-indigo-400" aria-hidden="true" />
        <p className="text-lg font-bold">فایل را رها کنید</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          برای ورود خودکار به صفحهٔ ورود داده منتقل می‌شوید
        </p>
      </div>
    </div>
  );
}
