import type {
  AssistantChatRequest,
  AssistantChatResponse,
} from "@/types/assistant";
import { apiRequest } from "@/lib/api/http-client";
import {
  API_PROXY_BASE_PATH,
  ASSISTANT_RESOURCE_PATH,
} from "@/lib/api/config";
import { readRawSession, type StoredSessionBase } from "@/lib/api/session-store";
import { hasActiveTenant } from "@/lib/api/session-logic";

export { hasActiveTenant } from "@/lib/api/session-logic";

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

if (typeof window !== "undefined") {
  window.addEventListener("roxira-auth-changed", () => {
    enabledPromise = null;
  });
}

/**
 * آیا دستیار روی سرور فعال است؟ (GET /enterprise-hub/assistant/status)
 * اگر کاربر در هیچ سازمانی نباشد، بدون فراخوانی سرور بلافاصله false برمی‌گرداند.
 * نتیجه در حافظه نگه داشته می‌شود؛ در خطا «غیرفعال» فرض می‌شود تا ورودی
 * دستیار بی‌دلیل نمایش داده نشود.
 */
export function fetchAssistantEnabled(): Promise<boolean> {
  const currentToken = readRawSession<StoredSessionBase>()?.accessToken;
  if (!hasActiveTenant(currentToken)) {
    return Promise.resolve(false);
  }
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

/** ریست کش وضعیت دستیار */
export function resetAssistantEnabledCache(): void {
  enabledPromise = null;
}
