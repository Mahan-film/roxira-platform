/** Server-only loader for /plans: prices and limits both come from one backend response. */

export interface PlanLimits {
  chat_messages_per_hour: Record<"guest" | "free" | "vip", number | null>;
  chat_messages_per_day?: Record<"guest" | "free" | "vip", number | null>;
  voice_requests_per_hour: Record<"guest" | "free" | "vip", number | null>;
  file_uploads_per_day: Record<"guest" | "free" | "vip", number | null>;
  max_file_mb: number;
  max_pages_per_file: number;
  max_files_per_chat: number;
  max_message_chars: number;
  draft_types: Record<"guest" | "free" | "vip", string[]>;
  vip_only_draft_types: string[];
}

export interface PlansPayload {
  plans: Record<string, { name: string; price_toman: number; price_rial: number }>;
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
