import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { buttonClass } from "@/components/ui/button";
import { APP_NAME } from "@/lib/utils";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="font-semibold">
            {APP_NAME}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/#features">{t("nav.features")}</Link>
            <Link href="/#pricing">{t("nav.pricing")}</Link>
            <Link href="/#faq">{t("nav.faq")}</Link>
            <LanguageSwitcher />
            <Link href="/sign-in">{t("nav.signIn")}</Link>
            <Link href="/sign-up" className={buttonClass("default", "sm")}>
              {t("nav.getStarted")}
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border py-6 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4">
          <span>
            © {new Date().getFullYear()} {APP_NAME}
          </span>
          <nav className="flex gap-4">
            <Link href="/legal/terms">{t("footer.terms")}</Link>
            <Link href="/legal/privacy">{t("footer.privacy")}</Link>
            <Link href="/legal/ai-disclosure">{t("footer.ai")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
