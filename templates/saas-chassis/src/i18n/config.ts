export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** Locales written right-to-left. The root layout sets <html dir> from this. */
export const rtlLocales: readonly Locale[] = ["ar"];

export const localeNames: Record<Locale, string> = { en: "English", ar: "العربية" };

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(v: string | undefined): v is Locale {
  return !!v && (locales as readonly string[]).includes(v);
}
