"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signUp = mode === "sign-up";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setBusy(true);
    setError(null);
    const res = signUp
      ? await authClient.signUp.email({ name: String(f.get("name")), email, password })
      : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong");
    router.push("/dashboard");
    router.refresh();
  }

  async function magicLink(form: HTMLFormElement) {
    const email = String(new FormData(form).get("email") ?? "");
    if (!email) return setError(t("email"));
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.magicLink({ email, callbackURL: "/dashboard" });
    setBusy(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong");
    setNotice(t("magicLinkSent"));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {signUp && (
        <div className="space-y-1">
          <Label htmlFor="name">{t("name")}</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={signUp ? "new-password" : "current-password"}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {signUp ? t("submitSignUp") : t("submitSignIn")}
      </Button>
      {!signUp && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          className="w-full"
          onClick={(e) => magicLink(e.currentTarget.form as HTMLFormElement)}
        >
          {t("magicLink")}
        </Button>
      )}
      <p className="text-center text-sm text-muted-foreground">
        {signUp ? t("haveAccount") : t("noAccount")}{" "}
        <Link href={signUp ? "/sign-in" : "/sign-up"} className="underline">
          {signUp ? t("submitSignIn") : t("submitSignUp")}
        </Link>
      </p>
    </form>
  );
}
