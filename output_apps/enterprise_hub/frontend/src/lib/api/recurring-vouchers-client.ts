import { apiRequest } from "@/lib/api/http-client";
import { ACCOUNTING_RESOURCE_PATH, API_PROXY_BASE_PATH } from "@/lib/api/config";
import type {
  RecurringVoucher,
  RecurringVoucherFrequency,
  RecurringVoucherLine,
  RunRecurringVouchersResult,
} from "@/types/recurring-vouchers";

const BASE = `${API_PROXY_BASE_PATH}/${ACCOUNTING_RESOURCE_PATH}/recurring-vouchers`;

export interface RecurringVoucherInput {
  name: string;
  description: string;
  lines: RecurringVoucherLine[];
  frequency: RecurringVoucherFrequency;
  nextRunDate: string;
  endDate?: string;
  autoReverse?: boolean;
  active?: boolean;
}

/** فهرست الگوهای سند دوره‌ای — GET /enterprise-hub/accounting/recurring-vouchers */
export const listRecurringVouchers = (signal?: AbortSignal): Promise<RecurringVoucher[]> =>
  apiRequest<RecurringVoucher[]>(BASE, { signal });

/** ایجاد الگو — POST /enterprise-hub/accounting/recurring-vouchers */
export const createRecurringVoucher = (body: RecurringVoucherInput): Promise<RecurringVoucher> =>
  apiRequest<RecurringVoucher>(BASE, { method: "POST", body });

/** ویرایش الگو — PUT /enterprise-hub/accounting/recurring-vouchers/:id */
export const updateRecurringVoucher = (
  id: number,
  body: Partial<RecurringVoucherInput>,
): Promise<RecurringVoucher> =>
  apiRequest<RecurringVoucher>(`${BASE}/${id}`, { method: "PUT", body });

/** حذف الگو — DELETE /enterprise-hub/accounting/recurring-vouchers/:id */
export const deleteRecurringVoucher = (id: number): Promise<void> =>
  apiRequest<void>(`${BASE}/${id}`, { method: "DELETE" });

/** اجرای موارد سررسیده — POST /enterprise-hub/accounting/recurring-vouchers/run-due */
export const runDueRecurringVouchers = (date?: string): Promise<RunRecurringVouchersResult> =>
  apiRequest<RunRecurringVouchersResult>(`${BASE}/run-due`, {
    method: "POST",
    body: date ? { date } : {},
  });
