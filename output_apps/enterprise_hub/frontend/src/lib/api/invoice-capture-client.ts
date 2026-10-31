import type { CaptureDraft, CaptureSettings, CaptureView } from "@/types/invoice-capture";
import { apiDownload, apiRequest, apiUpload } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, ASSISTANT_RESOURCE_PATH } from "@/lib/api/config";

// Same-origin proxy; the model key stays on the server (never in this bundle).
const CAPTURE_ENDPOINT = `${API_PROXY_BASE_PATH}/${ASSISTANT_RESOURCE_PATH}/capture`;

/** ارسال عکس/PDF/صوت/متن فاکتور — POST .../capture/documents */
export function createCapture(
  input: { file?: File; text?: string },
  signal?: AbortSignal,
): Promise<CaptureView> {
  const form = new FormData();
  if (input.file) form.append("file", input.file);
  if (input.text?.trim()) form.append("text", input.text.trim());
  return apiUpload<CaptureView>(`${CAPTURE_ENDPOINT}/documents`, form, signal);
}

export const updateCapture = (id: string, draft: CaptureDraft): Promise<CaptureView> =>
  apiRequest<CaptureView>(`${CAPTURE_ENDPOINT}/documents/${id}`, { method: "PATCH", body: draft });

/** ثبت یک‌کلیکی سند — از طریق AccountingService در بک‌اند. */
export const postCapture = (id: string): Promise<CaptureView> =>
  apiRequest<CaptureView>(`${CAPTURE_ENDPOINT}/documents/${id}/post`, { method: "POST", body: {} });

export const rejectCapture = (id: string): Promise<CaptureView> =>
  apiRequest<CaptureView>(`${CAPTURE_ENDPOINT}/documents/${id}/reject`, { method: "POST", body: {} });

export const reverseCapture = (id: string, reason?: string): Promise<CaptureView> =>
  apiRequest<CaptureView>(`${CAPTURE_ENDPOINT}/documents/${id}/reverse`, {
    method: "POST",
    body: { reason },
  });

export const markCaptureReviewed = (id: string): Promise<CaptureView> =>
  apiRequest<CaptureView>(`${CAPTURE_ENDPOINT}/documents/${id}/review`, { method: "POST", body: {} });

export const fetchCaptureQueue = (): Promise<CaptureView[]> =>
  apiRequest<CaptureView[]>(`${CAPTURE_ENDPOINT}/queue`);

export const fetchCaptureSettings = (): Promise<CaptureSettings> =>
  apiRequest<CaptureSettings>(`${CAPTURE_ENDPOINT}/settings`);

/** فقط مدیر سازمان (سرور بررسی می‌کند). */
export const saveCaptureSettings = (settings: CaptureSettings): Promise<CaptureSettings> =>
  apiRequest<CaptureSettings>(`${CAPTURE_ENDPOINT}/settings`, { method: "PUT", body: settings });

/** تصویر/فایل منبع برای نمایش کنار پیش‌نویس. */
export const fetchCaptureSource = (id: string, signal?: AbortSignal): Promise<Blob> =>
  apiDownload(`${CAPTURE_ENDPOINT}/documents/${id}/source`, signal);
