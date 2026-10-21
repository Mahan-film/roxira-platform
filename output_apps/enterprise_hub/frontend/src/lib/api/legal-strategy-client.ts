/**
 * Client for POST /api/v1/apps/judge/legal-strategy («استراتژی حقوقی»).
 *
 * One request returns the whole multi-track report. Identity and plan come from the Bearer
 * token only (never from the body). No secrets here.
 */
import {
  NETWORK_FAILURE,
  RetryTimeoutError,
  TIMEOUT_FAILURE,
  authHeaders,
  failureFromResponse,
  fetchWithRetry,
  hasAuthHeader,
  newRequestId,
  withoutAuthHeader,
  type ChatFailure,
} from "@/lib/api/judge-chat-client";

export const LEGAL_STRATEGY_PATH = "/api/v1/apps/judge/legal-strategy";

export type ArbitrationClause = "yes" | "no" | "unknown";

export interface StrategyIntake {
  what_happened: string;
  counterparty: string;
  arbitration_clause: ArbitrationClause;
  amount: string;
  dates: string;
  notes: string;
}

export const MIN_WHAT_HAPPENED = 20;
export const MAX_WHAT_HAPPENED = 6000;

export interface StrategyTrack {
  key: "criminal" | "civil" | "disciplinary" | "other";
  title: string;
  why: string;
  status: "ok" | "failed";
  /** False when no law article was retrieved for this track. */
  grounded: boolean;
  markdown: string;
  citations: { law_name: string; article_no: string }[];
  warnings: string[];
}

export interface StrategyReport {
  status: "ok";
  depth: "full" | "short";
  case_domain: string;
  summary: string;
  tracks: StrategyTrack[];
  /** Markdown table: goal / authority / evidence / cost-time / risks per track. */
  comparison_table: string;
  interactions: string;
  sequencing: string;
  checklist: string;
  missing_info: string[];
  warnings: string[];
  disclaimer: string;
  markdown: string;
  upsell?: { message: string; plans_url: string; locked_tracks: string[] };
}

export class LegalStrategyError extends Error {
  failure: ChatFailure;
  constructor(failure: ChatFailure) {
    super(failure.message);
    this.name = "LegalStrategyError";
    this.failure = failure;
  }
}

const STRATEGY_TIMEOUT_MS = 180_000;

export async function legalStrategy(
  body: StrategyIntake & { case_file_ids?: string[] },
  opts: { token: string | null | undefined; onAuthExpired?: () => void; requestId?: string },
): Promise<StrategyReport> {
  const requestId = opts.requestId ?? newRequestId();
  const payload = JSON.stringify({ ...body, request_id: requestId });
  const send = (headers: Record<string, string>) =>
    fetchWithRetry(
      LEGAL_STRATEGY_PATH,
      { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: payload },
      { maxAttempts: 1, timeoutMs: STRATEGY_TIMEOUT_MS, retryOnGatewayStatus: false, requestId },
    );
  let res: Response;
  try {
    const headers = authHeaders(opts.token);
    res = await send(headers);
    if (res.status === 401 && hasAuthHeader(headers)) {
      opts.onAuthExpired?.();
      res = await send(withoutAuthHeader(headers));
    }
  } catch (err) {
    throw new LegalStrategyError(err instanceof RetryTimeoutError ? TIMEOUT_FAILURE : NETWORK_FAILURE);
  }
  const data: unknown = await res.json().catch(() => null);
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (!res.ok || !obj || obj.status !== "ok" || !Array.isArray(obj.tracks)) {
    throw new LegalStrategyError(failureFromResponse(res.status || 500, data));
  }
  return obj as unknown as StrategyReport;
}
