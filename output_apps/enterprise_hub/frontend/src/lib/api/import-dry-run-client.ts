import { API_PROXY_BASE_PATH, DATA_IMPORT_RESOURCE_PATH } from "@/lib/api/config";
import { apiRequest } from "@/lib/api/http-client";
import type { ImportDryRunReport, ImportDryRunSource } from "@/lib/import-dry-run-helpers";

const BASE = `${API_PROXY_BASE_PATH}/${DATA_IMPORT_RESOURCE_PATH}`;

/**
 * Executes a full transactional dry-run for Sepidar or Holoo import.
 * The backend commits nothing (unconditional PostgreSQL transaction rollback)
 * and returns entity counts, opening trial balance, unmapped accounts,
 * duplicate parties, and open cheques totals.
 */
export async function runTransactionalImportDryRun(
  source: ImportDryRunSource,
  payload: Record<string, unknown>,
): Promise<ImportDryRunReport> {
  const endpoint = source === "sepidar" ? `${BASE}/dry-run/sepidar` : `${BASE}/dry-run/holoo`;
  return apiRequest<ImportDryRunReport>(endpoint, {
    method: "POST",
    body: payload,
  });
}
