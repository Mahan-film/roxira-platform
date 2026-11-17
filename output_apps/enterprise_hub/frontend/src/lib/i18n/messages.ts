import * as fs from 'node:fs';
import * as path from 'node:path';

export type Locale = 'fa' | 'en';

export const DEFAULT_LOCALE: Locale = 'fa';
export const SUPPORTED_LOCALES: readonly Locale[] = ['fa', 'en'] as const;

function deepMerge(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Loads messages for the given locale.
 * Catalogues live in messages/<locale>/<namespace>.json.
 * If locale is 'en', any missing namespace or missing key falls back to 'fa'.
 */
export function getMessages(locale: string = DEFAULT_LOCALE): Record<string, any> {
  const normLocale = locale === 'en' ? 'en' : 'fa';
  const root = path.resolve(process.cwd(), 'messages');
  const faDir = path.join(root, 'fa');
  const targetDir = path.join(root, normLocale);

  const messages: Record<string, any> = {};

  // 1. Load Persian base messages
  if (fs.existsSync(faDir)) {
    const files = fs.readdirSync(faDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const ns = path.basename(file, '.json');
      try {
        const raw = fs.readFileSync(path.join(faDir, file), 'utf8');
        messages[ns] = JSON.parse(raw);
      } catch (err) {
        console.warn(`[i18n] Failed to read ${file} for fa:`, err);
      }
    }
  }

  // 2. If English requested, deep merge over Persian base (missing keys fall back to Persian)
  if (normLocale === 'en' && fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const ns = path.basename(file, '.json');
      try {
        const raw = fs.readFileSync(path.join(targetDir, file), 'utf8');
        const enData = JSON.parse(raw);
        messages[ns] = deepMerge(messages[ns] || {}, enData);
      } catch (err) {
        console.warn(`[i18n] Failed to read ${file} for en:`, err);
      }
    }
  }

  return messages;
}
