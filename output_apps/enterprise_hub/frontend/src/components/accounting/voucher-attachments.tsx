"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DownloadIcon,
  Loader2Icon,
  PaperclipIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteVoucherAttachment,
  downloadVoucherAttachment,
  listVoucherAttachments,
  uploadVoucherAttachment,
} from "@/lib/api/accounting-client";
import { ApiClientError } from "@/lib/api/http-client";
import { isoToJalaliInput } from "@/lib/jalali";
import type { VoucherAttachment } from "@/types/accounting";

/** همان سقف بک‌اند: ۵ مگابایت. */
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".xlsx", ".csv"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
}

interface VoucherAttachmentsProps {
  journalEntryId: number;
}

/**
 * بخش «پیوست‌ها» برای یک سند حسابداری: فهرست، بارگذاری، دانلود و حذف.
 * بارگذاری روی هر وضعیت سند (حتی قطعی) مجاز است؛ حذف در دورهٔ قفل‌شده رد می‌شود.
 */
export function VoucherAttachments({ journalEntryId }: VoucherAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<VoucherAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setItems(await listVoucherAttachments(journalEntryId));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.details.join(" | ") : "دریافت پیوست‌ها ناموفق بود.");
    } finally {
      setIsLoading(false);
    }
  }, [journalEntryId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("حجم پیوست بیش از ۵ مگابایت است.");
      return;
    }
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
      setError("نوع پیوست پشتیبانی نمی‌شود (PDF، تصویر، Excel یا CSV).");
      return;
    }
    setIsUploading(true);
    try {
      const uploaded = await uploadVoucherAttachment(journalEntryId, file);
      setItems((previous) => [...previous, uploaded]);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.details.join(" | ") : "بارگذاری پیوست ناموفق بود.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDownload(attachment: VoucherAttachment) {
    setError(null);
    setBusyId(attachment.id);
    try {
      const blob = await downloadVoucherAttachment(journalEntryId, attachment.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.details.join(" | ") : "دانلود پیوست ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(attachment: VoucherAttachment) {
    setError(null);
    setBusyId(attachment.id);
    try {
      await deleteVoucherAttachment(journalEntryId, attachment.id);
      setItems((previous) => previous.filter((item) => item.id !== attachment.id));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.details.join(" | ") : "حذف پیوست ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <PaperclipIcon className="size-4 text-indigo-500" />
              پیوست‌ها
            </CardTitle>
            <CardDescription className="mt-1">
              تصویر، PDF، Excel یا CSV تا ۵ مگابایت؛ حتی برای سند قطعی قابل افزودن است.
            </CardDescription>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={ALLOWED_EXTENSIONS.join(",")}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            بارگذاری پیوست
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>خطا</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            در حال بارگیری...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">هیچ پیوستی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-48">نام فایل</TableHead>
                  <TableHead className="w-28">حجم</TableHead>
                  <TableHead className="w-32">تاریخ</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((attachment) => (
                  <TableRow key={attachment.id}>
                    <TableCell className="break-all">{attachment.fileName}</TableCell>
                    <TableCell>{formatSize(attachment.sizeBytes)}</TableCell>
                    <TableCell>{isoToJalaliInput(attachment.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="دانلود"
                          disabled={busyId === attachment.id}
                          onClick={() => void handleDownload(attachment)}
                        >
                          <DownloadIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title="حذف"
                          disabled={busyId === attachment.id}
                          onClick={() => void handleDelete(attachment)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
