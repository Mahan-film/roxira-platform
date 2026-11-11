import { API_PROXY_BASE_PATH } from '@/lib/api/config';
import { apiRequest } from '@/lib/api/http-client';
import type {
  GenerateLinkCodeResponse,
  ReceiptBotStatusResponse,
  UpdateReceiptBotPreferencesInput,
} from '@/types/receipt-bot';

const BASE = `${API_PROXY_BASE_PATH}/enterprise-hub/integrations/receipt-bot`;

export function getReceiptBotStatus(signal?: AbortSignal): Promise<ReceiptBotStatusResponse> {
  return apiRequest<ReceiptBotStatusResponse>(`${BASE}/status`, { signal });
}

export function generateReceiptBotCode(signal?: AbortSignal): Promise<GenerateLinkCodeResponse> {
  return apiRequest<GenerateLinkCodeResponse>(`${BASE}/link-code`, {
    method: 'POST',
    signal,
  });
}

export function unlinkReceiptBot(signal?: AbortSignal): Promise<void> {
  return apiRequest<void>(`${BASE}/link`, {
    method: 'DELETE',
    signal,
  });
}

export function updateReceiptBotPreferences(
  input: UpdateReceiptBotPreferencesInput,
  signal?: AbortSignal,
): Promise<ReceiptBotStatusResponse> {
  return apiRequest<ReceiptBotStatusResponse>(`${BASE}/preferences`, {
    method: 'PUT',
    body: input,
    signal,
  });
}
