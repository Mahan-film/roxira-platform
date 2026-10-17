import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";
import { SUPPORT_PHONE } from "@/lib/guide-content";

// Served at /contact on ghazihoushmand.ir (middleware rewrite). Sales form stays on roxira.ir.
export const metadata: Metadata = {
  title: "پشتیبانی | قاضی هوشمند",
  description: "راه‌های ارتباط با پشتیبانی قاضی هوشمند و راهنمای استفاده.",
  alternates: { canonical: "https://ghazihoushmand.ir/contact" },
};

export default function SupportPage() {
  return (
    <div className="dark ap-theme ghazi-theme flex min-h-dvh flex-col" data-theme="dark" dir="rtl" lang="fa">
      <GhaziHeader />
      <main className="mx-auto w-full max-w-[var(--ap-content-max)] flex-1 px-4 py-10">
        <section className="ap-card space-y-4" aria-labelledby="support-title">
          <h1 id="support-title" className="text-2xl font-semibold">پشتیبانی قاضی هوشمند</h1>
          <p className="ap-muted">برای مشکل فنی، پرداخت یا حساب کاربری با پشتیبانی تماس بگیرید.</p>
          <p>
            <span className="ap-muted">تلفن: </span>
            <a href={`tel:${SUPPORT_PHONE}`} dir="ltr" className="ap-link font-semibold">
              {SUPPORT_PHONE}
            </a>
          </p>
          <p>
            پاسخ بیشتر پرسش‌ها در{" "}
            <Link href="/guide" className="ap-link underline">
              راهنمای استفاده
            </Link>{" "}
            آمده است.
          </p>
          <p className="ap-notice">پاسخ‌های هوش مصنوعی مشاوره حقوقی رسمی نیستند و باید توسط وکیل بازبینی شوند.</p>
        </section>
      </main>
      <EnamadFooter compact={true} />
    </div>
  );
}
