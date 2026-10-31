import { CAPTURE_MIN_CONFIDENCE_FLOOR } from '../constants/capture.constants';
import { FieldConfidence, Finding } from './capture.types';

const WEIGHTS: Record<string, number> = {
  total: 3,
  date: 2,
  seller: 2,
  items: 2,
  tax: 1,
  invoice_number: 1,
  tax_id: 1,
};

/**
 * Overall confidence in [0,1]. The model's self-reported per-field confidence is only an input: it
 * is capped by deterministic evidence (arithmetic that does not add up, unreadable date, missing or
 * invalid tax id, suspected injection), so a confidently wrong model cannot reach the auto threshold.
 */
export function overallConfidence(
  fields: FieldConfidence,
  findings: Finding[],
  notes: string[],
): number {
  let weighted = 0;
  let weights = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    weighted += (fields[key] ?? 0) * weight;
    weights += weight;
  }
  let score = weights > 0 ? weighted / weights : 0;
  const has = (code: string): boolean => findings.some((f) => f.code === code);
  if (findings.some((f) => f.severity === 'error')) {
    score = Math.min(score, 0.6);
  }
  if (has('TAX_ID_MISSING') || has('TAX_ID_INVALID') || has('INVOICE_NUMBER_MISSING')) {
    score = Math.min(score, 0.9);
  }
  if (has('ITEM_MISMATCH') || has('VAT_RATE_ODD')) {
    score = Math.min(score, 0.85);
  }
  if (notes.includes('INJECTION_SUSPECTED')) {
    score = Math.min(score, 0.5);
  }
  return Math.round(score * 1000) / 1000;
}

export interface AutoPostInput {
  autoEnabled: boolean;
  minConfidence: number;
  rule: { autoPost: boolean; maxAmountIrr: string } | null;
  confidence: number;
  findings: Finding[];
  totalMinor: bigint;
  maxMinor: bigint | null;
  injectionSuspected: boolean;
}

/** Auto-post gate: every condition must hold; the reasons explain a refusal in the review queue. */
export function decideAuto(input: AutoPostInput): { auto: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.autoEnabled) {
    reasons.push('AUTO_DISABLED');
  }
  if (!input.rule?.autoPost) {
    reasons.push('NO_AUTO_RULE_FOR_VENDOR');
  }
  if (input.confidence < Math.max(input.minConfidence, CAPTURE_MIN_CONFIDENCE_FLOOR)) {
    reasons.push('LOW_CONFIDENCE');
  }
  if (input.findings.length > 0) {
    reasons.push('HAS_FINDINGS');
  }
  if (input.maxMinor !== null && input.totalMinor > input.maxMinor) {
    reasons.push('ABOVE_VENDOR_CAP');
  }
  if (input.injectionSuspected) {
    reasons.push('INJECTION_SUSPECTED');
  }
  return { auto: reasons.length === 0, reasons };
}
