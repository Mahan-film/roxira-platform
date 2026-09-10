import { CreateDamageCalculationRequest, DamageCalculationResponse } from '@/types/damages';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000';

export async function calculateDamage(
  payload: CreateDamageCalculationRequest,
): Promise<DamageCalculationResponse> {
  const response = await fetch(`${API_BASE_URL}/enterprise-hub/damages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
