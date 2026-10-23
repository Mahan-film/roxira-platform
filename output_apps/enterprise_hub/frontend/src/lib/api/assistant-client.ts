import type {
  AssistantChatRequest,
  AssistantChatResponse,
} from "@/types/assistant";
import { apiRequest } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  ASSISTANT_RESOURCE_PATH,
} from "@/lib/api/config";

// Same-origin proxy; the model key stays on the server (never in this bundle).
const ASSISTANT_ENDPOINT = `${API_PROXY_BASE_PATH}/${ASSISTANT_RESOURCE_PATH}`;

/** پرسش از دستیار — POST /enterprise-hub/assistant/chat */
export async function askAssistant(
  payload: AssistantChatRequest,
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  return apiRequest<AssistantChatResponse>(`${ASSISTANT_ENDPOINT}/chat`, {
    method: "POST",
    body: payload,
    signal,
  });
}

let enabledPromise: Promise<boolean> | null = null;

/**
 * آیا دستیار روی سرور فعال است؟ (GET /enterprise-hub/assistant/status)
 * نتیجه در حافظه نگه داشته می‌شود؛ در خطا «غیرفعال» فرض می‌شود تا ورودی
 * دستیار بی‌دلیل نمایش داده نشود.
 */
export function fetchAssistantEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = apiRequest<{ enabled: boolean }>(`${ASSISTANT_ENDPOINT}/status`)
      .then((status) => status.enabled === true)
      .catch(() => {
        enabledPromise = null; // allow a retry on the next mount
        return false;
      });
  }
  return enabledPromise;
}
