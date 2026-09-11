import type {
  CaseAnalysisResponse,
  CaseStrategyResponse,
  DelayDamagesResponse,
  RetrialEvalResponse,
} from "@/lib/api/smart-judge-client";

/** نتیجه ساختاریافته‌ای که درون حباب گفتگو رندر می‌شود. */
export type ChatResult =
  | { kind: "analysis"; data: CaseAnalysisResponse }
  | { kind: "strategy"; data: CaseStrategyResponse }
  | { kind: "retrial"; data: RetrialEvalResponse }
  | { kind: "damages"; data: DelayDamagesResponse };

/** یک پیام در گفتگوی قاضی هوشمند. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: ChatResult;
  error?: boolean;
}

/** جریان فعال گفتگو (اگر کاربر چیپ اقدام سریع را انتخاب کرده باشد). */
export type ChatFlow =
  | { kind: "none" }
  | { kind: "strategy" }
  | { kind: "retrial-description"; retrialType: "CRIMINAL_474" | "CIVIL_426" | "SPECIAL_477" }
  | {
      kind: "retrial-identity";
      retrialType: "CRIMINAL_474" | "CIVIL_426" | "SPECIAL_477";
      description: string;
    }
  | {
      kind: "retrial-confirm";
      retrialType: "CRIMINAL_474" | "CIVIL_426" | "SPECIAL_477";
      description: string;
      identifier: string;
    };
