import { CAPTURE_MAX_ITEMS } from '../constants/capture.constants';
import { CaptureKind, DraftItem, ExtractionResult, FieldConfidence } from './capture.types';
import {
  cleanText,
  milliToString,
  minorToString,
  normaliseCurrencyCode,
  normaliseDate,
  normaliseTaxId,
  parseAmountMinor,
  parseQuantityMilli,
} from './normalise';
import { toAsciiDigits } from '../../data_import/normaliser/normalise';
import { looksLikeInjection } from './redact';

/** JSON shape the model is asked for (also embedded in the prompt). */
export const EXTRACTION_JSON_SHAPE = `{
  "kind": "purchase" | "sales",
  "seller": {"name": string, "tax_id": string},
  "buyer": {"name": string, "tax_id": string},
  "invoice_number": string,
  "date": string,            // exactly as printed (Jalali ok)
  "currency": string,        // as printed: ریال / تومان / USD ...
  "items": [{"description": string, "quantity": number|string, "unit_price": number|string, "total": number|string}],
  "subtotal": number|string|null,
  "tax": number|string|null,
  "total": number|string,
  "paid": boolean|null,
  "confidence": {"seller": 0-1, "buyer": 0-1, "tax_id": 0-1, "invoice_number": 0-1, "date": 0-1, "items": 0-1, "tax": 0-1, "total": 0-1}
}`;

const KNOWN_TOP_KEYS = new Set([
  'kind', 'seller', 'buyer', 'invoice_number', 'date', 'currency',
  'items', 'subtotal', 'tax', 'total', 'paid', 'confidence',
]);

export class ExtractionParseError extends Error {}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** First balanced JSON object in model output (code fences and chatter tolerated, never executed). */
export function extractJsonObject(content: string): unknown {
  const cleaned = content.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new ExtractionParseError('Model output has no JSON object.');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new ExtractionParseError('Model output is not valid JSON.');
  }
}

/**
 * Turns UNTRUSTED model output into a bounded, normalised draft. Unknown keys are dropped (and
 * noted), every string is length-capped and stripped of control characters, money is parsed exactly
 * and toman amounts are converted to rials. The result can never carry an account code, tenant id
 * or any instruction: only the fields of `DraftInvoice` that the document itself describes.
 */
export function parseExtraction(content: string, sourceText = ''): ExtractionResult {
  const raw = asObject(extractJsonObject(content));
  const notes: string[] = [];

  const dropped = Object.keys(raw).filter((key) => !KNOWN_TOP_KEYS.has(key));
  if (dropped.length > 0) {
    notes.push(`Ignored unexpected model keys: ${dropped.slice(0, 5).join(', ')}`);
  }
  if (looksLikeInjection(sourceText) || looksLikeInjection(content)) {
    notes.push('INJECTION_SUSPECTED');
  }

  const seller = asObject(raw.seller);
  const buyer = asObject(raw.buyer);
  let currency = normaliseCurrencyCode(raw.currency);
  const factor = currency === 'IRT' ? 10n : 1n;
  if (currency === 'IRT') {
    currency = 'IRR';
    notes.push('Amounts were in toman and were multiplied by 10 to rial.');
  }

  const money = (value: unknown): bigint | null => {
    const minor = parseAmountMinor(value);
    return minor === null ? null : minor * factor;
  };

  const items: DraftItem[] = [];
  const rawItems = Array.isArray(raw.items) ? raw.items.slice(0, CAPTURE_MAX_ITEMS) : [];
  for (const entry of rawItems) {
    const item = asObject(entry);
    const total = money(item.total);
    const unit = money(item.unit_price);
    const qty = parseQuantityMilli(item.quantity ?? '1') ?? 1000n;
    items.push({
      description: cleanText(item.description),
      quantity: milliToString(qty),
      unitPrice: minorToString(unit ?? 0n),
      total: minorToString(total ?? ((unit ?? 0n) * qty) / 1000n),
      accountCode: null,
    });
  }

  const subtotal = money(raw.subtotal);
  const tax = money(raw.tax);
  const total = money(raw.total);
  const itemSum = items.reduce((s, i) => s + BigInt(i.total.replace('.', '')), 0n);

  const confidenceRaw = asObject(raw.confidence);
  const fieldConfidence: FieldConfidence = {};
  for (const key of ['seller', 'buyer', 'tax_id', 'invoice_number', 'date', 'items', 'tax', 'total']) {
    fieldConfidence[key] = clamp01(confidenceRaw[key]);
  }

  const kind: CaptureKind = raw.kind === 'sales' ? 'sales' : 'purchase';
  const draft = {
    kind,
    sellerName: cleanText(seller.name),
    sellerTaxId: normaliseTaxId(seller.tax_id),
    buyerName: cleanText(buyer.name),
    buyerTaxId: normaliseTaxId(buyer.tax_id),
    invoiceNumber: toAsciiDigits(cleanText(raw.invoice_number, 64)),
    date: normaliseDate(raw.date),
    currency,
    fxRate: null,
    items,
    subtotal: minorToString(subtotal ?? itemSum),
    tax: minorToString(tax ?? 0n),
    total: minorToString(total ?? (subtotal ?? itemSum) + (tax ?? 0n)),
    paid: raw.paid === true,
    notes: '',
  };
  return { draft, fieldConfidence, notes };
}
