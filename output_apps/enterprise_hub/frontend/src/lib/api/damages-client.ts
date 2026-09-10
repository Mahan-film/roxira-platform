import {
  CreateDamageCalculationDto,
  DamageCalculationResponseDto,
  PaginatedDamageCalculationResponse,
  QueryDamageCalculationDto,
} from '@/types/damages';
import { apiRequest } from '@/lib/api/http-client';
import { API_PROXY_BASE_PATH, DAMAGES_RESOURCE_PATH } from '@/lib/api/config';

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const DAMAGES_ENDPOINT = `${API_PROXY_BASE_PATH}/${DAMAGES_RESOURCE_PATH}`;

/**
 * ثبت یک محاسبه خسارت تاخیر تادیه جدید.
 * منطبق با `DamagesController.create` (POST /enterprise-hub/damages).
 * در صورت خطای اعتبارسنجی، `ApiClientError` (از `http-client.ts`) پرتاب می‌شود.
 */
export async function calculateDamage(
  payload: CreateDamageCalculationDto,
  signal?: AbortSignal,
): Promise<DamageCalculationResponseDto> {
  return apiRequest<DamageCalculationResponseDto>(DAMAGES_ENDPOINT, {
    method: 'POST',
    body: payload,
    signal,
  });
}

export const createDamageCalculation = calculateDamage;

/**
 * دریافت فهرست صفحه‌بندی‌شده محاسبات خسارت.
 * منطبق با `DamagesController.findAll` (GET /enterprise-hub/damages) و
 * `QueryDamageCalculationDto`. پارامتر دوم اختیاری `AbortSignal` است تا
 * درخواست‌های قدیمی هنگام تغییر فیلتر/صفحه لغو شوند.
 */
export async function listDamageCalculations(
  params: QueryDamageCalculationDto = {},
  signal?: AbortSignal,
): Promise<PaginatedDamageCalculationResponse> {
  return apiRequest<PaginatedDamageCalculationResponse>(DAMAGES_ENDPOINT, {
    method: 'GET',
    searchParams: {
      page: params.page,
      limit: params.limit,
      contractReferenceNumber: params.contractReferenceNumber,
    },
    signal,
  });
}

/**
 * دریافت یک رکورد محاسبه خسارت بر اساس شناسه.
 * منطبق با `DamagesController.findOne` (GET /enterprise-hub/damages/:id).
 */
export async function getDamageCalculation(
  id: string,
  signal?: AbortSignal,
): Promise<DamageCalculationResponseDto> {
  return apiRequest<DamageCalculationResponseDto>(`${DAMAGES_ENDPOINT}/${id}`, {
    method: 'GET',
    signal,
  });
}
