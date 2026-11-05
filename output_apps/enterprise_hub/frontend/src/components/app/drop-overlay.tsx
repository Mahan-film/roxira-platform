"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  const pathname = usePathname();
  const { setPendingFile, setPendingTab } = useImportHandoff();
  const [active, setActive] = useState(false);
  // The import page has its own drop zones; the overlay would only cover them.
  const onImportPage = pathname?.startsWith("/app/import") ?? false;

  useEffect(() => {
    // Browsers (Safari above all) do not fire matching dragenter/dragleave
    // pairs, and a drop handled by a local drop zone may never reach window, so
    // counting enter/leave leaves the overlay stuck on screen. dragover fires
    // continuously while a drag is over the page, so the overlay stays only
    // while dragover keeps arriving and hides shortly after it stops.
    let hideTimer: number | undefined;
    const hide = () => {
      window.clearTimeout(hideTimer);
      setActive(false);
    };
    const keepAlive = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hide, 300);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (!onImportPage) setActive(true);
      keepAlive();
    };
    // Capture phase: runs before any local drop zone, even one that stops propagation.
    const onDropCapture = () => hide();
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      // A local drop zone (e.g. the import wizard) already handled this drop.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      setPendingFile(file);
      setPendingTab(isDatabaseFile(file) ? "package" : "file");
      if (!onImportPage) router.push("/app/import");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    window.addEventListener("dragenter", onDragOver);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDropCapture, true);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(hideTimer);
      window.removeEventListener("dragenter", onDragOver);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDropCapture, true);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [router, onImportPage, setPendingFile, setPendingTab]);

  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur"
      aria-hidden="true"
      data-testid="drop-overlay"
    >
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-indigo-400 bg-indigo-500/10 px-10 py-12 text-center">
        <FileUp className="size-12 text-indigo-400" aria-hidden="true" />
        <p className="text-lg font-bold">فایل را رها کنید</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          برای ورود خودکار به صفحهٔ ورود از اکسل منتقل می‌شوید
        </p>
      </div>
    </div>
  );
}
