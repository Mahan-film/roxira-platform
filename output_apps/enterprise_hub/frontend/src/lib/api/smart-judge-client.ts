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
  options: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal } = {},
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
