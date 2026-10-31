"use client";

import { use, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { PasswordAuthPanel } from "@/components/auth/password-auth-panel";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { acceptInvitation, previewInvitation } from "@/lib/api/access-client";
import { switchToOrganization } from "@/components/app/access-provider";
import { type UiLocale, inferUiLocale } from "@/lib/api/auth-client";
import { ApiClientError } from "@/lib/api/http-client";
import { SYSTEM_ROLE_LABELS, type InvitationPreview } from "@/types/access";

const COPY = {
  fa: { title: "دعوت به سازمان", joinAs: "نقش شما", accept: "پیوستن به سازمان", haveAccount: "حساب دارید؟ وارد شوید", noAccount: "حساب ندارید؟ بسازید", bad: "این دعوت‌نامه معتبر نیست یا منقضی شده است.", signedIn: "با حساب فعلی خود وارد شده‌اید." },
  en: { title: "Invitation", joinAs: "Your role", accept: "Join organization", haveAccount: "Have an account? Sign in", noAccount: "No account? Create one", bad: "This invitation is not valid or has expired.", signedIn: "You are signed in with your current account." },
} as const;

/** Public landing page of an invitation link: sign up (no organisation name asked) or sign in, then join. */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { isAuthenticated, isLoading, applySession } = useAuth();
  const [locale] = useState<UiLocale>(() => (typeof window !== "undefined" ? inferUiLocale() : "fa"));
  const t = COPY[locale];
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [bad, setBad] = useState(false);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previewInvitation(token).then(setPreview).catch(() => setBad(true));
  }, [token]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const { tenantId } = await acceptInvitation(token);
      await switchToOrganization(tenantId, locale === "en" ? "/en/app" : "/app");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.details.join(" ") : t.bad);
      setBusy(false);
    }
  };

  return (
    <main className="dark mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 bg-background p-6 text-foreground" dir={locale === "fa" ? "rtl" : "ltr"}>
      <h1 className="text-xl font-bold">{t.title}</h1>
      {bad && <p role="alert" data-testid="invite-bad">{t.bad}</p>}
      {preview && (
        <div className="rounded-2xl border border-border p-4 text-sm" data-testid="invite-preview">
          <p className="text-lg font-bold">{preview.organizationName}</p>
          <p className="text-muted-foreground">{t.joinAs}: {SYSTEM_ROLE_LABELS[preview.roleKey] ?? preview.roleKey}</p>
        </div>
      )}
      {preview && !isLoading && isAuthenticated && (
        <>
          <p className="text-xs text-muted-foreground">{t.signedIn}</p>
          <Button onClick={join} disabled={busy} data-testid="invite-accept">{busy ? <Loader2 className="size-4 animate-spin" /> : t.accept}</Button>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        </>
      )}
      {preview && !isLoading && !isAuthenticated && (
        <>
          <PasswordAuthPanel
            key={mode}
            locale={locale}
            initialMode={mode}
            inviteToken={token}
            onSession={async (session) => {
              applySession(session);
              if (mode === "login") {
                try { await acceptInvitation(token); } catch { /* already a member */ }
              }
              window.location.assign(locale === "en" ? "/en/app" : "/app");
            }}
          />
          <button type="button" className="text-xs text-sky-300 hover:underline" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
            {mode === "signup" ? t.haveAccount : t.noAccount}
          </button>
        </>
      )}
    </main>
  );
}
