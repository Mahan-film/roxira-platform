import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH, TAX_COMPLIANCE_RESOURCE_PATH } from "@/lib/api/config";
import type {
  BusinessTaxPreview,
  BusinessTaxPreviewDto,
  CorporateTaxPreview,
  CorporateTaxPreviewDto,
  DoctorWithholdingPreview,
  DoctorWithholdingPreviewDto,
  RentalTaxPreview,
  RentalTaxPreviewDto,
} from "@/types/tax-previews";

const BASE_PATH = `${API_PROXY_BASE_PATH}/${TAX_COMPLIANCE_RESOURCE_PATH}`;

/**
 * پیش‌نمایش ذخیره مالیات بر درآمد شرکت‌ها (بدون ثبت سند).
 * منطبق با POST /enterprise-hub/tax-compliance/corporate-tax/preview
 */
export async function previewCorporateTax(
  dto: CorporateTaxPreviewDto,
  signal?: AbortSignal,
): Promise<CorporateTaxPreview> {
  return apiRequest<CorporateTaxPreview>(`${BASE_PATH}/corporate-tax/preview`, {
    method: "POST",
    body: dto,
    signal,
  });
}

/**
 * پیش‌نمایش مالیات صاحبان مشاغل و مشارکت مدنی (ماده ۱۰۱) (بدون ثبت سند).
 * منطبق با POST /enterprise-hub/tax-compliance/business-tax/preview
 */
export async function previewBusinessTax(
  dto: BusinessTaxPreviewDto,
  signal?: AbortSignal,
): Promise<BusinessTaxPreview> {
  return apiRequest<BusinessTaxPreview>(`${BASE_PATH}/business-tax/preview`, {
    method: "POST",
    body: dto,
    signal,
  });
}

/**
 * پیش‌نمایش مالیات بر درآمد اجاره و معافیت ماده ۵۷ (بدون ثبت سند).
 * منطبق با POST /enterprise-hub/tax-compliance/rental-tax/preview
 */
export async function previewRentalTax(
  dto: RentalTaxPreviewDto,
  signal?: AbortSignal,
): Promise<RentalTaxPreview> {
  return apiRequest<RentalTaxPreview>(`${BASE_PATH}/rental-tax/preview`, {
    method: "POST",
    body: dto,
    signal,
  });
}

/**
 * پیش‌نمایش کسر مالیات علی‌الحساب از حق‌الزحمه پزشکان (بدون ثبت سند).
 * منطبق با POST /enterprise-hub/tax-compliance/doctor-withholding/preview
 */
export async function previewDoctorWithholding(
  dto: DoctorWithholdingPreviewDto,
  signal?: AbortSignal,
): Promise<DoctorWithholdingPreview> {
  return apiRequest<DoctorWithholdingPreview>(`${BASE_PATH}/doctor-withholding/preview`, {
    method: "POST",
    body: dto,
    signal,
  });
}
