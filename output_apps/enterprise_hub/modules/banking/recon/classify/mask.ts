import { extractCounterparty, normaliseText } from './classifier';

/**
 * Masks identifying details before a statement description may leave the system (LLM prompt, log).
 * IBANs, card/account/national-id/phone digit runs and the counterparty name are replaced; nothing
 * unmasked is ever sent to a model. The amount and direction are not identifying and stay outside.
 */
export function maskForLlm(description: string, knownNames: string[] = []): string {
  let text = normaliseText(description);
  const names = new Set<string>(knownNames.map((n) => normaliseText(n)).filter((n) => n.length >= 3));
  const cp = extractCounterparty(description);
  if (cp) {
    names.add(cp.name);
  }
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    text = text.split(name).join('[NAME]');
  }
  return text
    .replace(/ir\s?\d[\d\s]{20,30}/gi, '[IBAN]')
    .replace(/\b\d{16}\b/g, '[CARD]')
    .replace(/\b09\d{9}\b/g, '[PHONE]')
    .replace(/\b\d{10}\b/g, '[ID]')
    .replace(/\b\d{6,}\b/g, '[NUM]')
    .slice(0, 300);
}

/** Port for an optional model assist. No implementation is wired in this module. */
export interface ClassifierLlm {
  /** Receives only masked text; the caller is responsible for routing through config/models.yaml. */
  suggest(maskedDescription: string, direction: 'in' | 'out'): Promise<{ category: string; confidence: number } | null>;
}
