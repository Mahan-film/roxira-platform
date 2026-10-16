"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function WaitlistForm({ source = "landing" }: { source?: string }) {
  const t = useTranslations("landing");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    setState("busy");
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale, source }),
    });
    setState(res.ok ? "done" : "error");
  }

  if (state === "done") return <p role="status">{t("waitlistThanks")}</p>;
  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input name="email" type="email" required placeholder={t("waitlistPlaceholder")} aria-label="Email" />
      <Button type="submit" disabled={state === "busy"}>
        {t("waitlistButton")}
      </Button>
      {state === "error" && (
        <p role="alert" className="sr-only">
          {t("waitlistError")}
        </p>
      )}
    </form>
  );
}
