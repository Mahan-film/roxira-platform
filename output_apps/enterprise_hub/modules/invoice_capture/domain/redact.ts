import { toAsciiDigits } from '../../data_import/normaliser/normalise';

const RULES: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [MASKED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[MASKED_JWT]'],
  [/\b(?:sk|pk|rk|gsk|xox[abp]|ghp|gho|AKIA)[-_A-Za-z0-9]{16,}/g, '[MASKED_KEY]'],
  [
    /\b(api[_-]?key|secret|token|password|passwd|پسورد|رمز(?:\s*عبور)?)\s*[:=]\s*\S+/gi,
    '$1: [MASKED]',
  ],
  [/\bIR\d{24}\b/gi, '[MASKED_IBAN]'],
];

/**
 * Masks secrets and card numbers before text is sent to a model provider or written to a log.
 * Persian digits are folded first so a card number written in Persian digits is caught too.
 */
export function redactSecrets(text: string): string {
  let out = toAsciiDigits(text);
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\b(?:\d[ -]?){15}\d\b/g, '[MASKED_CARD]');
}

const INJECTION_HINTS = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /(system|developer)\s*(prompt|message)\s*:/i,
  /\b(call|run|invoke|execute)\b.{0,30}\b(tool|function|command)\b/i,
  /(دستورات|قوانین)\s*(قبلی|بالا)\s*را\s*(نادیده|فراموش)/,
  /(post|register|ثبت)\b.{0,20}\b(this|it|را)\b.{0,20}(automatically|خودکار)/i,
];

/** True when document text looks like an attempt to instruct the model. Only ever adds a warning. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_HINTS.some((pattern) => pattern.test(text));
}
