import {
  ExchangeRatesResponse,
  SupportedCurrenciesResponse,
} from "@/types/currency";
import { apiRequest } from "@/lib/api/http-client";
import { API_PROXY_BASE_PATH } from "@/lib/api/config";

// از پروکسی هم‌مبدأ next.config.ts (`rewrites`) عبور می‌کند تا مشکل CORS
// رخ ندهد و آدرس واقعی سرویس NestJS در کد سمت مرورگر افشا نشود.
const CURRENCY_ENDPOINT = `${API_PROXY_BASE_PATH}/enterprise-hub/currency`;

/** فهرست ارزهای پشتیبانی‌شده — GET /enterprise-hub/currency */
export async function getSupportedCurrencies(
  signal?: AbortSignal,
): Promise<SupportedCurrenciesResponse> {
  return apiRequest<SupportedCurrenciesResponse>(CURRENCY_ENDPOINT, {
    method: "GET",
    signal,
  });
}

/** نرخ تبدیل ارزها نسبت به ارز پایه — GET /enterprise-hub/currency/rates */
export async function getExchangeRates(
  signal?: AbortSignal,
): Promise<ExchangeRatesResponse> {
  return apiRequest<ExchangeRatesResponse>(`${CURRENCY_ENDPOINT}/rates`, {
    method: "GET",
    signal,
  });
}
