/** Server-only loader for /plans: prices and limits both come from one backend response. */

import type { BackendPlanPrice } from "@/components/judge/subscription/types";

type BaseTier = "guest" | "free" | "vip";
type PaidTier = "basic" | "pro" | "premium" | "team";

export interface PlanLimits {
  chat_messages_per_hour: Record<BaseTier, number | null>;
  chat_messages_per_day?: Record<BaseTier, number | null> & Partial<Record<PaidTier, number | null>>;
  /** Answers per day served by the best model of the level before it steps down. */
  top_model_answers_per_day?: Partial<Record<"pro" | "premium" | "team", number | null>>;
  voice_requests_per_hour: Record<BaseTier, number | null> & Partial<Record<PaidTier, number | null>>;
  file_uploads_per_day: Record<BaseTier, number | null> & Partial<Record<PaidTier, number | null>>;
  max_file_mb: number;
  max_pages_per_file: number;
  max_files_per_chat: number;
  max_message_chars: number;
  draft_types: Record<BaseTier, string[]> & Partial<Record<PaidTier, string[]>>;
  vip_only_draft_types: string[];
}

export interface PlansPayload {
  plans: Record<string, BackendPlanPrice>;
  limits: PlanLimits;
}

const JUDGE_API_ORIGIN = process.env.JUDGE_API_ORIGIN ?? "http://localhost:8000";
export const PLANS_REVALIDATE_SECONDS = 300;

/** Returns null when the backend is unreachable or the response is malformed (never invents numbers). */
export async function loadPlans(): Promise<PlansPayload | null> {
  try {
    const res = await fetch(`${JUDGE_API_ORIGIN}/api/v1/apps/judge/payments/pricing-matrix`, {
      next: { revalidate: PLANS_REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PlansPayload>;
    if (!data.limits) return null; // plans may lack keys; the page handles that per card
    return data as PlansPayload;
  } catch {
    return null;
  }
}
