import { API_PROXY_BASE_PATH, INVOICING_RESOURCE_PATH } from "@/lib/api/config";
import { ApiClientError, apiRequest } from "@/lib/api/http-client";
import {
  CreatePrintTemplateDto,
  PrintDocType,
  PrintPaperSize,
  PrintTemplateDto,
  RenderBarcodeSheetDto,
  UpdatePrintTemplateDto,
} from "@/types/print-template";

const PRINT_TEMPLATES_ENDPOINT = `${API_PROXY_BASE_PATH}/${INVOICING_RESOURCE_PATH}/print-templates`;

export interface QueryPrintTemplateParams {
  docType?: PrintDocType;
  paperSize?: PrintPaperSize;
  search?: string;
}

/**
 * دریافت فهرست قالب‌های چاپی سازمان
 */
export async function listPrintTemplates(
  params: QueryPrintTemplateParams = {},
  signal?: AbortSignal,
): Promise<PrintTemplateDto[]> {
  return apiRequest<PrintTemplateDto[]>(PRINT_TEMPLATES_ENDPOINT, {
    method: "GET",
    searchParams: {
      docType: params.docType,
      paperSize: params.paperSize,
    },
    signal,
  });
}

/**
 * دریافت یک قالب چاپی با شناسه
 */
export async function getPrintTemplate(
  id: number,
  signal?: AbortSignal,
): Promise<PrintTemplateDto> {
  return apiRequest<PrintTemplateDto>(`${PRINT_TEMPLATES_ENDPOINT}/${id}`, {
    method: "GET",
    signal,
  });
}

/**
 * دریافت قالب پیش‌فرض برای یک نوع سند و اندازه کاغذ
 */
export async function getDefaultPrintTemplate(
  docType: PrintDocType,
  paperSize?: PrintPaperSize,
  signal?: AbortSignal,
): Promise<PrintTemplateDto | null> {
  try {
    return await apiRequest<PrintTemplateDto>(`${PRINT_TEMPLATES_ENDPOINT}/default`, {
      method: "GET",
      searchParams: {
        docType,
        paperSize,
      },
      signal,
    });
  } catch (err) {
    // 404 = this tenant never saved a default: callers print the original layout.
    if (err instanceof ApiClientError && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Like getDefaultPrintTemplate, but never throws: any failure (network, 5xx)
 * also means "use the original layout", so printing is never blocked.
 */
export async function getDefaultPrintTemplateOrNull(
  docType: PrintDocType,
  paperSize?: PrintPaperSize,
): Promise<PrintTemplateDto | null> {
  try {
    return await getDefaultPrintTemplate(docType, paperSize);
  } catch {
    return null;
  }
}

/** Starting values for the builder form (not a saved template, never used for printing). */
export async function getPrintTemplatePreset(
  docType: PrintDocType,
  paperSize?: PrintPaperSize,
  signal?: AbortSignal,
): Promise<PrintTemplateDto> {
  return apiRequest<PrintTemplateDto>(`${PRINT_TEMPLATES_ENDPOINT}/preset`, {
    method: "GET",
    searchParams: { docType, paperSize },
    signal,
  });
}

/**
 * ایجاد قالب چاپی جدید
 */
export async function createPrintTemplate(
  dto: CreatePrintTemplateDto,
  signal?: AbortSignal,
): Promise<PrintTemplateDto> {
  return apiRequest<PrintTemplateDto>(PRINT_TEMPLATES_ENDPOINT, {
    method: "POST",
    body: dto,
    signal,
  });
}

/**
 * ویرایش قالب چاپی
 */
export async function updatePrintTemplate(
  id: number,
  dto: UpdatePrintTemplateDto,
  signal?: AbortSignal,
): Promise<PrintTemplateDto> {
  return apiRequest<PrintTemplateDto>(`${PRINT_TEMPLATES_ENDPOINT}/${id}`, {
    method: "PATCH",
    body: dto,
    signal,
  });
}

/**
 * حذف قالب چاپی
 */
export async function deletePrintTemplate(
  id: number,
  signal?: AbortSignal,
): Promise<{ success: boolean; id: number }> {
  return apiRequest<{ success: boolean; id: number }>(
    `${PRINT_TEMPLATES_ENDPOINT}/${id}`,
    {
      method: "DELETE",
      signal,
    },
  );
}

/**
 * تولید HTML شیت برچسب بارکد ۴ یا ۵ ستونه
 */
export async function renderBarcodeSheetHtml(
  dto: RenderBarcodeSheetDto,
  signal?: AbortSignal,
): Promise<string> {
  const res = await apiRequest<{ html: string }>(`${PRINT_TEMPLATES_ENDPOINT}/barcode-sheet`, {
    method: "POST",
    body: dto,
    signal,
  });
  return res.html;
}
