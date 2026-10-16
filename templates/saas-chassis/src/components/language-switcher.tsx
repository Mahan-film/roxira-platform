"use client";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { localeNames, locales } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Language"
      value={locale}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setLocale(e.target.value);
          router.refresh();
        })
      }
      className="h-8 rounded-md border border-border bg-background px-2 text-sm"
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}
