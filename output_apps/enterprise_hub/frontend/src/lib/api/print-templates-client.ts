import { API_PROXY_BASE_PATH, INVOICING_RESOURCE_PATH } from "@/lib/api/config";
import { apiRequest } from "@/lib/api/http-client";
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
      search: params.search,
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
): Promise<PrintTemplateDto> {
  return apiRequest<PrintTemplateDto>(`${PRINT_TEMPLATES_ENDPOINT}/default`, {
    method: "GET",
    searchParams: {
      docType,
      paperSize,
    },
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
  return apiRequest<string>(`${PRINT_TEMPLATES_ENDPOINT}/barcode-sheet`, {
    method: "POST",
    body: dto,
    signal,
  });
}
