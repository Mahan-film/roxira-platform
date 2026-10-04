/**
 * کلاینت اتصال به موتور قاضی هوشمند (AI Core Layer — FastAPI/Python).
 *
 * مطابق بند ۱ AGENTS.md، لایه هوش مصنوعی مستقل از NestJS است و روی روتر
 * `/api/v1/apps/judge` سرو می‌شود. برای پرهیز از CORS و عدم افشای آدرس
 * واقعی سرویس پایتون، تمام فراخوانی‌ها از مسیر هم‌مبدأ
 * `JUDGE_API_PROXY_BASE_PATH` عبور می‌کنند که در `next.config.ts`
 * (rewrites) به‌صورت سرور-به-سرور به `JUDGE_API_ORIGIN` هدایت می‌شود.
 *
 * قرارداد (Contract-First) این فایل دقیقاً منطبق بر مدل‌های Pydantic و
 * خروجی اندپوینت‌های `smartjudge_module.py` است:
 *   • POST /analyze-case       → AnalyzeCaseRequest
 *   • POST /retrial-evaluate   → RetrialEvalRequest
 *   • GET  /health             → وضعیت آنلاین موتور GraphRAG
 */

import { JUDGE_API_PROXY_BASE_PATH } from "@/lib/api/config";

/** سطوح دیسپچر LLM — tier1 سریع/ارزان، tier2 دقت بالا، tier3 تحلیل عمیق */
export type JudgeEngineTier = "tier1" | "tier2" | "tier3";

/** جهات قانونی اعاده دادرسی پذیرفته‌شده در موتور */
export type RetrialType = "CRIMINAL_474" | "CIVIL_426" | "SPECIAL_477";

/** ورودی اندپوینت تحلیل پرونده (`AnalyzeCaseRequest`) */
export interface AnalyzeCaseRequest {
  case_text: string;
  engine_tier?: JudgeEngineTier;
  attached_files?: string[];
}

/** یک ماده/مستند قانونی استخراج‌شده از لایه برداری GraphRAG */
export interface MatchedLaw {
  title: string;
  category: string;
  text: string;
}

/** یک رابطه گراف حقوقی (لایه Graph — PostgreSQL) */
export interface GraphRelation {
  source: string;
  relation: string;
  target: string;
  description: string;
}

/** خروجی ساختاریافته تحلیل پرونده (`_llm_analyze`) */
export interface CaseAnalysisResponse {
  status: string;
  tier: string;
  tier_label: string;
  query_type: string;
  response_mode: string;
  model_used: string;
  legal_advisory: string;
  matched_laws: MatchedLaw[];
  cited_precedents: string[];
  draft_text: string;
  success_probability: string;
  jurisdiction: string;
  free_access: boolean;
  retrieval: {
    mode: string;
    vector: unknown;
    graph: {
      status: string;
      nodes_matched: number;
      relations_matched: number;
    };
  };
  graph_relations: GraphRelation[];
}

/** ورودی اندپوینت اعاده دادرسی (`RetrialEvalRequest`) */
export interface RetrialEvalRequest {
  case_description: string;
  verdict_details?: string;
  retrial_type: RetrialType;
  user_identifier: string;
  is_verified: boolean;
}

/** خروجی ارزیابی اعاده دادرسی (`_retrial_evaluate_engine`) */
export interface RetrialEvalResponse {
  status: string;
  retrial_type: RetrialType;
  retrial_label: string;
  matched_clause: string;
  eligibility_score: number;
  eligibility_analysis: string;
  legal_evaluation: string;
  petition_text: string;
  missing_requirements: string[];
  cited_precedents: string[];
  statutory_grounds: string[];
  model_used: string;
  retrieval: {
    vector: unknown;
    graph_nodes: number;
  };
  response_id: number;
  quota: {
    used: number;
    free_quota: number;
    remaining: number;
  };
}

/** وضعیت موتور GraphRAG (`GET /health`) */
export interface JudgeEngineHealth {
  status: string;
  engine: string;
  llm_configured: boolean;
  groq_stt_configured: boolean;
  stt: string;
  prompt_caching: string;
  collections: string[];
  graph_relations: string[];
  tier_models: Record<string, string[]>;
  retrial_module: {
    free_quota: number;
    case_types: string[];
  };
  graph_db: {
    status?: string;
    graph_nodes?: number;
    graph_edges?: number;
    host?: string;
    error?: string;
  };
}

/**
 * خطای یکپارچه موتور قاضی هوشمند.
 * FastAPI جزئیات خطا را در کلید `detail` (رشته یا شیء ساختاریافته) برمی‌گرداند.
 */
export class SmartJudgeError extends Error {
  readonly statusCode: number;
  readonly detail: unknown;

  constructor(statusCode: number, detail: unknown) {
    const message =
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && "message" in detail
          ? String((detail as { message: unknown }).message)
          : "خطای ناشناخته از موتور قاضی هوشمند دریافت شد.";

    super(message);
    this.name = "SmartJudgeError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

const JUDGE_ENDPOINT = JUDGE_API_PROXY_BASE_PATH;

/**
 * اجرای درخواست تایپ‌سیف به موتور قاضی هوشمند از طریق پروکسی هم‌مبدأ
 * Next.js. در صورت خطا، `SmartJudgeError` با جزئیات `detail` پرتاب می‌شود.
 */
async function judgeRequest<TResponse>(
  path: string,
  options: { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<TResponse> {
  const response = await fetch(`${JUDGE_ENDPOINT}${path}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown; message?: unknown };
      detail = body.detail ?? body.message ?? response.statusText;
    } catch {
      detail = response.statusText;
    }
    throw new SmartJudgeError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return (await response.json()) as TResponse;
}

/**
 * تحلیل یکپارچه پرونده — استخراج مواد قانونی، استدلال قضایی و انشای لایحه.
 * منطبق با `POST /api/v1/apps/judge/analyze-case`.
 */
export async function analyzeCase(
  payload: AnalyzeCaseRequest,
  signal?: AbortSignal,
): Promise<CaseAnalysisResponse> {
  return judgeRequest<CaseAnalysisResponse>("/analyze-case", {
    method: "POST",
    body: {
      engine_tier: payload.engine_tier ?? "tier2",
      attached_files: payload.attached_files ?? [],
      case_text: payload.case_text,
    },
    signal,
  });
}

/**
 * ارزیابی شانس پذیرش اعاده دادرسی بر اساس جهات قانونی و شواهد مکتوم.
 * منطبق با `POST /api/v1/apps/judge/retrial-evaluate` (گیت OTP + سهمیه).
 */
export async function retrialEvaluate(
  payload: RetrialEvalRequest,
  signal?: AbortSignal,
): Promise<RetrialEvalResponse> {
  return judgeRequest<RetrialEvalResponse>("/retrial-evaluate", {
    method: "POST",
    body: {
      retrial_type: payload.retrial_type,
      case_description: payload.case_description,
      verdict_details: payload.verdict_details ?? "",
      user_identifier: payload.user_identifier,
      is_verified: payload.is_verified,
    },
    signal,
  });
}

/**
 * دریافت وضعیت آنلاین موتور GraphRAG (Qdrant + PostgreSQL + OpenRouter).
 * منطبق با `GET /api/v1/apps/judge/health`.
 */
export async function getJudgeEngineHealth(
  signal?: AbortSignal,
): Promise<JudgeEngineHealth> {
  return judgeRequest<JudgeEngineHealth>("/health", { method: "GET", signal });
}

/** فراداده یک سند تبدیل‌شده در موتور استراتژی (Word/PDF/عکس → Markdown). */
export interface ParsedDocumentMeta {
  filename: string;
  format: string;
  method: string;
  markdown: string;
  char_count: number;
  ocr_used: boolean;
  warnings: string[];
}

/** یک ماده قانونی استنادی در استراتژی چهارگانه. */
export interface StrategyStatutoryBasis {
  title: string;
  category: string;
  text: string;
  relevance: string;
}

/** یک رأی وحدت رویه حاکم در استراتژی چهارگانه. */
export interface StrategyPrecedent {
  title: string;
  summary: string;
  binding_effect: string;
}

/** خروجی موتور تدوین استراتژی حقوقی چهارگانه (`_build_case_strategy_engine`). */
export interface CaseStrategyResponse {
  status: string;
  tier: string;
  tier_label: string;
  model_used: string;
  evidence_analysis: string;
  success_probability: string;
  statutory_basis: StrategyStatutoryBasis[];
  unified_precedents: StrategyPrecedent[];
  defense_draft: string;
  source_documents: ParsedDocumentMeta[];
  retrieval: {
    mode: string;
    vector: unknown;
    graph: {
      status: string;
      nodes_matched: number;
      relations_matched: number;
    };
  };
  graph_relations: GraphRelation[];
}

/** ورودی ساخت استراتژی — متن پرونده و/یا فایل‌های پیوست (Word/PDF/عکس). */
export interface BuildCaseStrategyRequest {
  case_text?: string;
  engine_tier?: JudgeEngineTier;
  files?: File[];
}

/**
 * تدوین استراتژی چهارگانه حقوقی از فایل پیوست (Word/PDF/عکس) یا متن طولانی پرونده.
 * منطبق با `POST /api/v1/apps/judge/build-case-strategy` (multipart/form-data).
 */
export async function buildCaseStrategy(
  payload: BuildCaseStrategyRequest,
  signal?: AbortSignal,
): Promise<CaseStrategyResponse> {
  const form = new FormData();
  form.append("case_text", payload.case_text ?? "");
  form.append("engine_tier", payload.engine_tier ?? "tier3");
  for (const file of payload.files ?? []) {
    form.append("files", file, file.name);
  }

  const response = await fetch(`${JUDGE_ENDPOINT}/build-case-strategy`, {
    method: "POST",
    body: form,
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown; message?: unknown };
      detail = body.detail ?? body.message ?? response.statusText;
    } catch {
      detail = response.statusText;
    }
    throw new SmartJudgeError(response.status, detail);
  }

  return (await response.json()) as CaseStrategyResponse;
}

/** ورودی محاسبه خسارت تاخیر تادیه (`InflationCalcRequest`) */
export interface DelayDamagesRequest {
  principal_amount_irr: number;
  start_year: number;
  end_year?: number;
}

/** خروجی محاسبه خسارت تاخیر تادیه (ماده ۵۲۲ و رای وحدت رویه ۸۴۰) */
export interface DelayDamagesResponse {
  principal_amount: number;
  start_year: number;
  end_year: number;
  start_index: number;
  end_index: number;
  updated_value_to_date: number;
  total_delay_damages: number;
  legal_basis: string;
  index_source: string;
}

/**
 * محاسبه خسارت تاخیر تادیه بر پایه شاخص بانک مرکزی (ماده ۵۲۲ ق.آ.د.م).
 * منطبق با `POST /api/v1/apps/judge/calculate-delay-damages`.
 */
export async function calculateDelayDamages(
  payload: DelayDamagesRequest,
  signal?: AbortSignal,
): Promise<DelayDamagesResponse> {
  return judgeRequest<DelayDamagesResponse>("/calculate-delay-damages", {
    method: "POST",
    body: {
      principal_amount_irr: payload.principal_amount_irr,
      start_year: payload.start_year,
      end_year: payload.end_year ?? 1404,
    },
    signal,
  });
}

/**
 * تبدیل گفتار به متن (دیکته صوتی) — منطبق با `POST /api/v1/apps/judge/transcribe-audio`.
 * فایل صوتی ضبط‌شده در مرورگر به‌صورت multipart/form-data ارسال می‌شود.
 */
export async function transcribeAudio(
  audio: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  const extension = audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4")
      ? "mp4"
      : "webm";
  form.append("file", audio, `voice.${extension}`);

  const response = await fetch(`${JUDGE_ENDPOINT}/transcribe-audio`, {
    method: "POST",
    body: form,
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = body.detail ?? response.statusText;
    } catch {
      detail = response.statusText;
    }
    throw new SmartJudgeError(response.status, detail);
  }

  const data = (await response.json()) as { transcript?: string };
  return (data.transcript ?? "").trim();
}

/** یک پیام ذخیره‌شده در تاریخچه گفتگو (نقش + محتوا). */
export interface ConversationMessage {
  role: string;
  content: string;
}

/** یک گفتگوی ذخیره‌شده در جدول chat_conversations (enterprise_db). */
export interface ChatConversation {
  id: string;
  user_phone: string;
  title: string;
  messages: ConversationMessage[];
  created_at: string | null;
  updated_at: string | null;
}

/** ورودی ایجاد/به‌روزرسانی گفتگو (`POST /conversations`). */
export interface SaveConversationRequest {
  user_phone: string;
  conversation_id?: string | null;
  title?: string;
  messages: ConversationMessage[];
}

/** ورودی استریم زنده پاسخ (`POST /chat-stream`). */
export interface StreamChatRequest {
  messages: ConversationMessage[];
  user_phone?: string | null;
  engine_tier?: JudgeEngineTier;
  conversation_id?: string | null;
}

/** رخدادهای استریم SSE پاسخ قاضی هوشمند. */
export interface ChatStreamHandlers {
  onMeta?: (meta: { model: string; conversation_id: string | null }) => void;
  onDelta: (chunk: string) => void;
  onDone?: (info: { model: string }) => void;
  onError?: (message: string) => void;
}

/**
 * دریافت لیست تاریخچه گفتگوهای کاربر بر اساس شماره همراه.
 * منطبق با `GET /api/v1/apps/judge/conversations`.
 */
export async function listConversations(
  userPhone: string,
  signal?: AbortSignal,
): Promise<ChatConversation[]> {
  const data = await judgeRequest<{ conversations: ChatConversation[] }>(
    `/conversations?user_phone=${encodeURIComponent(userPhone)}`,
    { method: "GET", signal },
  );
  return data.conversations ?? [];
}

/**
 * ایجاد گفتگو یا به‌روزرسانی پیام‌ها و عنوان نشست جاری.
 * منطبق با `POST /api/v1/apps/judge/conversations`.
 */
export async function saveConversation(
  payload: SaveConversationRequest,
  signal?: AbortSignal,
): Promise<ChatConversation> {
  const data = await judgeRequest<{ conversation: ChatConversation }>("/conversations", {
    method: "POST",
    body: {
      user_phone: payload.user_phone,
      conversation_id: payload.conversation_id ?? null,
      title: payload.title ?? "",
      messages: payload.messages,
    },
    signal,
  });
  return data.conversation;
}

/**
 * حذف یک گفتگو از تاریخچه کاربر.
 * منطبق با `DELETE /api/v1/apps/judge/conversations/{id}`.
 */
export async function deleteConversation(
  conversationId: string,
  userPhone: string,
  signal?: AbortSignal,
): Promise<void> {
  await judgeRequest<{ status: string }>(
    `/conversations/${encodeURIComponent(conversationId)}?user_phone=${encodeURIComponent(userPhone)}`,
    { method: "DELETE", signal },
  );
}

/**
 * استریم زنده پاسخ (Server-Sent Events) و تحویل تکه‌های متن به‌صورت
 * کاراکتربه‌کاراکتر از طریق callbackهای تایپ‌سیف.
 * منطبق با `POST /api/v1/apps/judge/chat-stream`.
 */
export async function streamChat(
  payload: StreamChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${JUDGE_ENDPOINT}/chat-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      messages: payload.messages,
      user_phone: payload.user_phone ?? null,
      engine_tier: payload.engine_tier ?? "tier2",
      conversation_id: payload.conversation_id ?? null,
    }),
    signal,
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    let detail: unknown = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = body.detail ?? response.statusText;
    } catch {
      detail = response.statusText;
    }
    throw new SmartJudgeError(response.status, detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string) => {
    let event = "message";
    let raw = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) raw += line.slice(5).trim();
    }
    if (!raw) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === "meta") {
      handlers.onMeta?.({
        model: String(parsed.model ?? ""),
        conversation_id: (parsed.conversation_id as string | null) ?? null,
      });
    } else if (event === "delta") {
      handlers.onDelta(String(parsed.content ?? ""));
    } else if (event === "done") {
      handlers.onDone?.({ model: String(parsed.model ?? "") });
    } else if (event === "error") {
      handlers.onError?.(String(parsed.message ?? "خطای استریم پاسخ"));
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame.trim()) dispatch(frame);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) dispatch(buffer);
}

/* ------------------------------------------------------------------ */
/* پیش‌نویس غیررسمی رأی — POST /api/v1/apps/judge/drafts/ruling        */
/* منطبق با RulingDraftRequest در smartjudge_module.py و ruling_draft.py */
/* ------------------------------------------------------------------ */

import type { RulingCourtType } from "@/lib/court-types";
export type { RulingCourtType };

/** سقف‌های بک‌اند (ruling_draft.py) */
export const RULING_LIMITS = {
  maxName: 300,
  maxFacts: 12000,
  maxClaims: 6000,
  maxEvidenceItems: 20,
  maxEvidenceTitle: 200,
  maxEvidenceText: 6000,
} as const;

export interface RulingEvidenceItem {
  title: string;
  text: string;
}

export interface RulingDraftRequest {
  court_type: RulingCourtType;
  claimant: string;
  respondent: string;
  facts: string;
  claims: string;
  evidence: RulingEvidenceItem[];
  jurisdiction?: string;
}

export type RulingDraftStatus = "AI_DRAFT_UNVERIFIED" | "INSUFFICIENT_BASIS";

export interface RulingArticle {
  law_name: string;
  article_no: string;
}

export interface RulingRemovedCitation extends RulingArticle {
  reason: string;
}

export interface RulingDraftResponse {
  status: RulingDraftStatus;
  banner: string;
  requires_human_review: boolean;
  proposed_operative_part: string;
  articles?: RulingArticle[];
  removed_citations: RulingRemovedCitation[];
  missing_information: string[];
  disclaimer: string;
  draft_id: string;
  content_sha256: string;
  request_id?: string;
}

export type RulingDraftErrorKind = "vip_required" | "validation" | "network" | "server";

/** خطای پیش‌نویس رأی؛ `fieldErrors` از آرایه `detail` در 422 FastAPI ساخته می‌شود. */
export class RulingDraftError extends Error {
  readonly kind: RulingDraftErrorKind;
  readonly statusCode: number;
  readonly fieldErrors: Record<string, string>;

  constructor(
    kind: RulingDraftErrorKind,
    statusCode: number,
    fieldErrors: Record<string, string> = {},
  ) {
    super(kind);
    this.name = "RulingDraftError";
    this.kind = kind;
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
  }
}

function extractFieldErrors(detail: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(detail)) return out;
  for (const item of detail) {
    const loc = (item as { loc?: unknown })?.loc;
    if (!Array.isArray(loc)) continue;
    const parts = loc.filter((p) => p !== "body").map(String);
    if (parts.length) out[parts.join(".")] = String((item as { msg?: unknown }).msg ?? "");
  }
  return out;
}

/**
 * ساخت پیش‌نویس غیررسمی رأی (فقط VIP). احراز هویت سمت سرور از طریق نشست
 * هم‌مبدأ انجام می‌شود؛ هیچ کلید یا توکنی در کد فرانت‌اند قرار نمی‌گیرد.
 * قاب 403 بک‌اند ({type:"VIP_REQUIRED"}) در سطح بالای بدنه است، نه در `detail`.
 */
export async function draftRuling(
  payload: RulingDraftRequest,
  signal?: AbortSignal,
): Promise<RulingDraftResponse> {
  let response: Response;
  try {
    response = await fetch(`${JUDGE_ENDPOINT}/drafts/ruling`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new RulingDraftError("network", 0);
  }

  if (response.ok) return (await response.json()) as RulingDraftResponse;

  let body: { type?: string; detail?: unknown } = {};
  try {
    body = await response.json();
  } catch {
    /* بدنه JSON نیست */
  }
  if (response.status === 403 && body.type === "VIP_REQUIRED") {
    throw new RulingDraftError("vip_required", 403);
  }
  if (response.status === 422) {
    throw new RulingDraftError("validation", 422, extractFieldErrors(body.detail));
  }
  throw new RulingDraftError("server", response.status);
}

/* ------------------------------------------------------------------ */
/* راهنمای انتخاب دادگاه — POST /drafts/court-suggest (بدون نیاز به VIP) */
/* ------------------------------------------------------------------ */

export type CourtStage = "prosecution" | "trial" | "appeal" | "disciplinary" | "council";

export interface CourtSuggestRequest {
  facts: string; // 1..12000
  claims?: string; // <=6000, default ""
  hint?: string; // <=300
}

/** کلیدهای court_key پاسخ راهنمای دادگاه */
export type CourtSuggestKey =
  | "prosecution_investigator"
  | "prosecution_deputy"
  | "criminal_1"
  | "criminal_2"
  | "general_civil"
  | "peace"
  | "revolution"
  | "family"
  | "commercial"
  | "labor"
  | "administrative"
  | "dispute_council"
  | "guild_violations"
  | "computer_guild"
  | "bar_disciplinary";

export interface CourtSuggestion {
  court_key: CourtSuggestKey | (string & {});
  court_name_fa: string;
  stage: CourtStage;
  reason_fa: string;
  score: number;
}

export interface CourtSuggestResponse {
  suggestions: CourtSuggestion[];
  banner: string;
  requires_human_review: true;
  disclaimer: string;
  request_id: string;
}

/** خطای مشترک فراخوانی‌های پیش‌نویس (راهنمای دادگاه و کیفرخواست) */
export class DraftApiError extends Error {
  readonly kind: RulingDraftErrorKind;
  readonly statusCode: number;
  readonly fieldErrors: Record<string, string>;

  constructor(kind: RulingDraftErrorKind, statusCode: number, fieldErrors: Record<string, string> = {}) {
    super(kind);
    this.name = "DraftApiError";
    this.kind = kind;
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
  }
}

async function postDraft<T>(path: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${JUDGE_ENDPOINT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new DraftApiError("network", 0);
  }
  if (response.ok) return (await response.json()) as T;
  let body: { type?: string; detail?: unknown } = {};
  try {
    body = await response.json();
  } catch {
    /* بدنه JSON نیست */
  }
  if (response.status === 403 && body.type === "VIP_REQUIRED") throw new DraftApiError("vip_required", 403);
  if (response.status === 422) throw new DraftApiError("validation", 422, extractFieldErrors(body.detail));
  throw new DraftApiError("server", response.status);
}

export function suggestCourt(payload: CourtSuggestRequest, signal?: AbortSignal): Promise<CourtSuggestResponse> {
  return postDraft<CourtSuggestResponse>("/drafts/court-suggest", payload, signal);
}

/* ------------------------------------------------------------------ */
/* پیش‌نویس غیررسمی کیفرخواست — POST /drafts/indictment (فقط VIP)      */
/* ------------------------------------------------------------------ */

export const INDICTMENT_LIMITS = {
  maxName: 300,
  maxFacts: 12000,
  maxChargesHint: 1000,
  maxEvidenceItems: 20,
  maxEvidenceTitle: 200,
  maxEvidenceText: 6000,
} as const;

export interface IndictmentDraftRequest {
  accused: string;
  complainant: string;
  facts: string;
  charges_hint?: string;
  evidence: RulingEvidenceItem[]; // max 20
}

export interface IndictmentLegalBasis {
  law_name: string;
  article_no: string;
  reasoning: string;
}

/** پاسخ تخت (بدون شیء sections)؛ charge_description با «پیشنهاد (غیرقطعی):» آغاز می‌شود. */
export interface IndictmentDraftResponse {
  status: RulingDraftStatus;
  charge_description: string;
  evidence_summary: string;
  legal_basis: IndictmentLegalBasis[];
  removed_citations: string[];
  missing_information: string[];
  banner: string;
  requires_human_review: true;
  disclaimer: string;
  model_tier: string;
  request_id: string;
  draft_id: string;
  content_sha256: string;
}

export function draftIndictment(
  payload: IndictmentDraftRequest,
  signal?: AbortSignal,
): Promise<IndictmentDraftResponse> {
  return postDraft<IndictmentDraftResponse>("/drafts/indictment", payload, signal);
}
