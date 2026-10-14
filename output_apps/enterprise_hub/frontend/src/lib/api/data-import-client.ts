import { apiRequest, apiUpload } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  DATA_IMPORT_RESOURCE_PATH,
} from "@/lib/api/config";
import type {
  LeadImportCommitRequest,
  LeadImportPreview,
  LeadImportResult,
} from "@/types/data-import";

// از پروکسی هم‌مبدأ next.config.ts عبور می‌کند تا مشکل CORS رخ ندهد.
const DATA_IMPORT_ENDPOINT = `${API_PROXY_BASE_PATH}/${DATA_IMPORT_RESOURCE_PATH}`;

/** پیش‌نمایش فایل و نگاشت پیشنهادی — POST .../data-import/crm-leads/preview */
export async function previewLeadImport(
  file: File,
  signal?: AbortSignal,
): Promise<LeadImportPreview> {
  const formData = new FormData();
  formData.append("file", file);
  return apiUpload<LeadImportPreview>(
    `${DATA_IMPORT_ENDPOINT}/crm-leads/preview`,
    formData,
    signal,
  );
}

/** تأیید نگاشت و ورود نهایی — POST .../data-import/crm-leads/commit */
export async function commitLeadImport(
  payload: LeadImportCommitRequest,
  signal?: AbortSignal,
): Promise<LeadImportResult> {
  return apiRequest<LeadImportResult>(
    `${DATA_IMPORT_ENDPOINT}/crm-leads/commit`,
    { method: "POST", body: payload, signal },
  );
}
