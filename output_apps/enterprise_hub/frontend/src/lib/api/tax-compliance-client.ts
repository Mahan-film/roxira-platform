import {
  GenerateCsrDto,
  GenerateCsrResponse,
  PaginatedTaxSignaturesResponse,
  QueryTaxSignatureDto,
  SignInvoiceDto,
  SigningKeyResponseDto,
  TaxSignatureDetailResponseDto,
  VerifySignatureResponse,
} from "@/types/tax-compliance";
import { apiRequest } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  TAX_COMPLIANCE_RESOURCE_PATH,
} from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const TAX_COMPLIANCE_ENDPOINT = `${API_PROXY_BASE_PATH}/${TAX_COMPLIANCE_RESOURCE_PATH}`;

/**
 * امضای الکترونیک یک صورتحساب و تولید بسته مالیاتی (TaxID + JWS).
 * منطبق با `TaxComplianceController.signInvoice`
 * (POST /enterprise-hub/tax-compliance/sign-invoice).
 */
export async function signInvoice(
  payload: SignInvoiceDto,
  signal?: AbortSignal,
): Promise<TaxSignatureDetailResponseDto> {
  return apiRequest<TaxSignatureDetailResponseDto>(
    `${TAX_COMPLIANCE_ENDPOINT}/sign-invoice`,
    { method: "POST", body: payload, signal },
  );
}

/**
 * دریافت فهرست صفحه‌بندی‌شده بسته‌های امضاشده مالیاتی.
 * منطبق با `TaxComplianceController.findAll`
 * (GET /enterprise-hub/tax-compliance/signatures).
 */
export async function listTaxSignatures(
  params: QueryTaxSignatureDto = {},
  signal?: AbortSignal,
): Promise<PaginatedTaxSignaturesResponse> {
  return apiRequest<PaginatedTaxSignaturesResponse>(
    `${TAX_COMPLIANCE_ENDPOINT}/signatures`,
    {
      method: "GET",
      searchParams: {
        page: params.page,
        limit: params.limit,
        status: params.status,
        taxInvoiceNumber: params.taxInvoiceNumber,
        invoiceId: params.invoiceId,
        taxId: params.taxId,
      },
      signal,
    },
  );
}

/**
 * دریافت جزئیات یک بسته امضاشده.
 * منطبق با `TaxComplianceController.findOne`
 * (GET /enterprise-hub/tax-compliance/signatures/:id).
 */
export async function getTaxSignature(
  id: string,
  signal?: AbortSignal,
): Promise<TaxSignatureDetailResponseDto> {
  return apiRequest<TaxSignatureDetailResponseDto>(
    `${TAX_COMPLIANCE_ENDPOINT}/signatures/${id}`,
    { method: "GET", signal },
  );
}

/**
 * دریافت بسته کامل JSON برای دانلود.
 * منطبق با `TaxComplianceController.getPacket`
 * (GET /enterprise-hub/tax-compliance/signatures/:id/packet).
 */
export async function downloadTaxPacket(
  id: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>(
    `${TAX_COMPLIANCE_ENDPOINT}/signatures/${id}/packet`,
    { method: "GET", signal },
  );
}

/**
 * ارسال بسته امضاشده به سامانه مودیان و ثبت شماره مرجع.
 * منطبق با `TaxComplianceController.submit`
 * (POST /enterprise-hub/tax-compliance/signatures/:id/submit).
 */
export async function submitTaxSignature(
  id: string,
  signal?: AbortSignal,
): Promise<TaxSignatureDetailResponseDto> {
  return apiRequest<TaxSignatureDetailResponseDto>(
    `${TAX_COMPLIANCE_ENDPOINT}/signatures/${id}/submit`,
    { method: "POST", signal },
  );
}

/**
 * راستی‌آزمایی صحت امضای JWS یک بسته.
 * منطبق با `TaxComplianceController.verify`
 * (GET /enterprise-hub/tax-compliance/signatures/:id/verify).
 */
export async function verifyTaxSignature(
  id: string,
  signal?: AbortSignal,
): Promise<VerifySignatureResponse> {
  return apiRequest<VerifySignatureResponse>(
    `${TAX_COMPLIANCE_ENDPOINT}/signatures/${id}/verify`,
    { method: "GET", signal },
  );
}

/**
 * دریافت اطلاعات عمومی کلید فعال مالیاتی.
 * منطبق با `TaxComplianceController.getActiveKey`
 * (GET /enterprise-hub/tax-compliance/keys/active).
 */
export async function getActiveSigningKey(
  signal?: AbortSignal,
): Promise<SigningKeyResponseDto> {
  return apiRequest<SigningKeyResponseDto>(
    `${TAX_COMPLIANCE_ENDPOINT}/keys/active`,
    { method: "GET", signal },
  );
}

/**
 * تولید درخواست امضای گواهی (CSR) با کلید فعال سازمان.
 * منطبق با `TaxComplianceController.generateCsr`
 * (POST /enterprise-hub/tax-compliance/csr).
 */
export async function generateCertificateRequest(
  payload: GenerateCsrDto,
  signal?: AbortSignal,
): Promise<GenerateCsrResponse> {
  return apiRequest<GenerateCsrResponse>(`${TAX_COMPLIANCE_ENDPOINT}/csr`, {
    method: "POST",
    body: payload,
    signal,
  });
}
