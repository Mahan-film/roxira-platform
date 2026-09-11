import {
  CreateInvoiceDto,
  InvoiceResponseDto,
  PaginatedInvoiceResponse,
  QueryInvoiceDto,
} from "@/types/invoicing";
import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, INVOICING_RESOURCE_PATH } from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const INVOICING_ENDPOINT = `${API_PROXY_BASE_PATH}/${INVOICING_RESOURCE_PATH}`;

/**
 * صدور صورتحساب مالیاتی جدید.
 * منطبق با `InvoicingController.create` (POST /enterprise-hub/invoicing).
 * مالیات ۹٪ و جمع‌بندی مبالغ در سمت سرور بازمحاسبه می‌شوند.
 */
export async function createInvoice(
  payload: CreateInvoiceDto,
  signal?: AbortSignal,
): Promise<InvoiceResponseDto> {
  return apiRequest<InvoiceResponseDto>(INVOICING_ENDPOINT, {
    method: "POST",
    body: payload,
    signal,
  });
}

/**
 * دریافت فهرست صفحه‌بندی‌شده صورتحساب‌ها.
 * منطبق با `InvoicingController.findAll` (GET /enterprise-hub/invoicing).
 */
export async function listInvoices(
  params: QueryInvoiceDto = {},
  signal?: AbortSignal,
): Promise<PaginatedInvoiceResponse> {
  return apiRequest<PaginatedInvoiceResponse>(INVOICING_ENDPOINT, {
    method: "GET",
    searchParams: {
      page: params.page,
      limit: params.limit,
      status: params.status,
      taxInvoiceNumber: params.taxInvoiceNumber,
      currency: params.currency,
    },
    signal,
  });
}

/**
 * دریافت یک صورتحساب بر اساس شناسه.
 * منطبق با `InvoicingController.findOne` (GET /enterprise-hub/invoicing/:id).
 */
export async function getInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<InvoiceResponseDto> {
  return apiRequest<InvoiceResponseDto>(`${INVOICING_ENDPOINT}/${id}`, {
    method: "GET",
    signal,
  });
}

/**
 * ابطال صورتحساب.
 * منطبق با `InvoicingController.cancel` (PATCH /enterprise-hub/invoicing/:id/cancel).
 */
export async function cancelInvoice(
  id: string,
  signal?: AbortSignal,
): Promise<InvoiceResponseDto> {
  return apiRequest<InvoiceResponseDto>(
    `${INVOICING_ENDPOINT}/${id}/cancel`,
    {
      method: "PATCH",
      signal,
    },
  );
}
