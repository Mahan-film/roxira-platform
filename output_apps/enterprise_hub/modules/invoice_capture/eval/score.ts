import { DraftInvoice } from '../domain/capture.types';
import { normaliseName } from '../domain/normalise';
import { EvalTruth } from './dataset';

export const EVAL_FIELDS = [
  'kind', 'seller_name', 'seller_tax_id', 'invoice_number', 'date', 'currency',
  'items', 'subtotal', 'tax', 'total', 'paid',
] as const;
export type EvalField = (typeof EVAL_FIELDS)[number];

/** Fields whose error would put a wrong amount, date or counterparty in the ledger. */
export const CRITICAL_FIELDS: EvalField[] = ['seller_name', 'date', 'total', 'tax', 'kind'];

export type FieldResult = Record<EvalField, boolean>;

/** Exact field-by-field comparison (no fuzzy credit; names compare after normalisation only). */
export function scoreCase(draft: DraftInvoice | null, truth: EvalTruth): FieldResult {
  const none = Object.fromEntries(EVAL_FIELDS.map((f) => [f, false])) as FieldResult;
  if (!draft) {
    return none;
  }
  const items = [...draft.items.map((i) => i.total)].sort();
  return {
    kind: draft.kind === truth.kind,
    seller_name: normaliseName(draft.sellerName) === normaliseName(truth.sellerName),
    seller_tax_id: draft.sellerTaxId === truth.sellerTaxId,
    invoice_number: draft.invoiceNumber === truth.invoiceNumber,
    date: draft.date === truth.date,
    currency: draft.currency === truth.currency,
    items: items.length === truth.itemTotals.length && items.every((t, i) => t === truth.itemTotals[i]),
    subtotal: draft.subtotal === truth.subtotal,
    tax: draft.tax === truth.tax,
    total: draft.total === truth.total,
    paid: draft.paid === truth.paid,
  };
}

export interface Summary {
  n: number;
  failures: number;
  perField: Record<EvalField, number>;
  allCriticalCorrect: number;
  allFieldsCorrect: number;
}

export function summarise(results: Array<FieldResult | null>): Summary {
  const scored = results.map((r) => r ?? (Object.fromEntries(EVAL_FIELDS.map((f) => [f, false])) as FieldResult));
  const n = scored.length;
  const perField = Object.fromEntries(
    EVAL_FIELDS.map((f) => [f, scored.filter((r) => r[f]).length / n]),
  ) as Record<EvalField, number>;
  return {
    n,
    failures: results.filter((r) => r === null).length,
    perField,
    allCriticalCorrect: scored.filter((r) => CRITICAL_FIELDS.every((f) => r[f])).length / n,
    allFieldsCorrect: scored.filter((r) => EVAL_FIELDS.every((f) => r[f])).length / n,
  };
}
