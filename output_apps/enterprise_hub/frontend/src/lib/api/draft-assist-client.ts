/**
 * Client for POST /api/v1/apps/judge/draft-assist (conversational drafting).
 *
 * The server is stateless per turn: we send the conversation, the fields the user edited by
 * hand and the uploaded case-file ids; it answers need_info / ready / draft. Identity and tier
 * come from the Bearer token only (never from the body). No secrets here.
 */
import type { DraftType } from "@/lib/chat-actions";
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

export const DRAFT_ASSIST_PATH = "/api/v1/apps/judge/draft-assist";

export type DraftFields = Record<string, string | string[]>;

export interface FieldMeta {
  key: string;
  label: string;
  required: boolean;
  kind: "short" | "long" | "list";
  skippable: boolean;
}

export interface Choice {
  value: string;
  label: string;
}

export interface MissingField {
  key: string;
  label: string;
  skippable: boolean;
}

export interface DraftResult {
  draft_type: DraftType;
  title: string;
  draft_markdown: string;
  citations: { law_name: string; article_no: string }[];
  warnings: string[];
  disclaimer?: string;
}

export interface DraftAssistResponse {
  status: "need_info" | "ready" | "draft" | "not_draft" | "insufficient" | "vip_required";
  draft_type?: DraftType;
  title?: string;
  intro?: string;
  message?: string;
  question?: string;
  fields?: DraftFields;
  field_meta?: FieldMeta[];
  field_sources?: Record<string, string>;
  missing?: MissingField[];
  skipped?: string[];
  choices?: Choice[];
  court_options?: Choice[];
  court_name?: string;
  skip_label?: string;
  form_url?: string | null;
  // draft
  draft_markdown?: string;
  citations?: DraftResult["citations"];
  warnings?: string[];
  disclaimer?: string;
  missing_information?: string[];
}

export interface DraftAssistRequest {
  action: "assist" | "check" | "generate";
  draft_type?: DraftType;
  messages: { role: "user" | "assistant"; content: string }[];
  case_file_ids?: string[];
  known_fields?: DraftFields;
  skip_fields?: string[];
  revise?: { instruction: string; previous_draft: string };
}

export class DraftAssistError extends Error {
  failure: ChatFailure;
  constructor(failure: ChatFailure) {
    super(failure.message);
    this.name = "DraftAssistError";
    this.failure = failure;
  }
}

const CHECK_TIMEOUT_MS = 20_000;
const ASSIST_TIMEOUT_MS = 60_000;
const GENERATE_TIMEOUT_MS = 120_000;

export async function draftAssist(
  body: DraftAssistRequest,
  opts: { token: string | null | undefined; onAuthExpired?: () => void; requestId?: string },
): Promise<DraftAssistResponse> {
  const requestId = opts.requestId ?? newRequestId();
  const timeoutMs =
    body.action === "generate" ? GENERATE_TIMEOUT_MS : body.action === "assist" ? ASSIST_TIMEOUT_MS : CHECK_TIMEOUT_MS;
  const payload = JSON.stringify({ ...body, request_id: requestId });
  const send = (headers: Record<string, string>) =>
    fetchWithRetry(
      DRAFT_ASSIST_PATH,
      { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: payload },
      { maxAttempts: 2, timeoutMs, retryOnGatewayStatus: true, requestId },
    );
  let res: Response;
  try {
    const headers = authHeaders(opts.token);
    res = await send(headers);
    if (res.status === 401 && hasAuthHeader(headers)) {
      // Stale token: same silent guest fallback as the text chat.
      opts.onAuthExpired?.();
      res = await send(withoutAuthHeader(headers));
    }
  } catch (err) {
    throw new DraftAssistError(err instanceof RetryTimeoutError ? TIMEOUT_FAILURE : NETWORK_FAILURE);
  }
  const data: unknown = await res.json().catch(() => null);
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (res.status === 403 && obj?.status === "vip_required") return obj as unknown as DraftAssistResponse;
  if (!res.ok || !obj || typeof obj.status !== "string" || obj.status === "ERROR") {
    throw new DraftAssistError(failureFromResponse(res.status || 500, data));
  }
  return obj as unknown as DraftAssistResponse;
}
