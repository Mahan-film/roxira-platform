import {
  CreateDamageCalculationRequest,
  DamageCalculationResponse,
  PaginatedDamageCalculationResponse,
  QueryDamageCalculationParams,
} from '@/types/damages';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000';

export async function calculateDamage(
  payload: CreateDamageCalculationRequest,
): Promise<DamageCalculationResponse> {
  const response = await fetch(`${API_BASE_URL}/enterprise-hub/damages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = Array.isArray(errorData.message)
      ? errorData.message.join(', ')
      : errorData.message || 'خطا در محاسبه خسارت';
    throw new Error(message);
  }

  return response.json();
}

export async function listDamageCalculations(
  params: QueryDamageCalculationParams = {},
): Promise<PaginatedDamageCalculationResponse> {
  const query = new URLSearchParams();
  if (params.page) query.append('page', String(params.page));
  if (params.limit) query.append('limit', String(params.limit));
  if (params.contractReferenceNumber) query.append('contractReferenceNumber', params.contractReferenceNumber);

  const response = await fetch(`${API_BASE_URL}/enterprise-hub/damages?${query.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('خطا در دریافت فهرست محاسبات');
  }

  return response.json();
}

export async function getDamageCalculation(id: string): Promise<DamageCalculationResponse> {
  const response = await fetch(`${API_BASE_URL}/enterprise-hub/damages/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('رکورد محاسبه یافت نشد');
  }

  return response.json();
}
