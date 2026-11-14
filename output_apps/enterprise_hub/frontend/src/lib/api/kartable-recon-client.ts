import {
  API_PROXY_BASE_PATH,
  TAX_COMPLIANCE_RESOURCE_PATH,
} from "@/lib/api/config";
import type { KartableReconciliationResponse } from "@/types/kartable-reconciliation";
import { apiUpload } from "./http-client";

const BASE = `${API_PROXY_BASE_PATH}/${TAX_COMPLIANCE_RESOURCE_PATH}/kartable`;

export interface ReconcileKartableParams {
  year: number;
  quarter: number;
  salesFile?: File | null;
  purchasesFile?: File | null;
  signal?: AbortSignal;
}

export async function reconcileKartable({
  year,
  quarter,
  salesFile,
  purchasesFile,
  signal,
}: ReconcileKartableParams): Promise<KartableReconciliationResponse> {
  const form = new FormData();
  form.append("year", String(year));
  form.append("quarter", String(quarter));
  if (salesFile) {
    form.append("salesFile", salesFile, salesFile.name);
  }
  if (purchasesFile) {
    form.append("purchasesFile", purchasesFile, purchasesFile.name);
  }
  return apiUpload<KartableReconciliationResponse>(`${BASE}/reconcile`, form, signal);
}
