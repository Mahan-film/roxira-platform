import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";
import en from "../../messages/en.json";

type Messages = Record<string, unknown>;

function merge(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && b && typeof b === "object"
        ? merge(b as Messages, v as Messages)
        : v;
  }
  return out;
}

// Cookie-based locale (no URL prefix). English is the fallback for any missing key.
export default getRequestConfig(async () => {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookie) ? cookie : defaultLocale;
  const messages =
    locale === defaultLocale
      ? (en as Messages)
      : merge(en as Messages, (await import(`../../messages/${locale}.json`)).default as Messages);
  return { locale, messages };
});
