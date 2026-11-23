import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "امنیت و مرکز اعتماد | سامانه روکسیرا و قاضی هوشمند",
  description:
    "معماری امنیت، ایزولاسیون داده‌ها در سطح پایگاه‌داده با FORCE RLS، رمزنگاری، عدم آموزش مدل‌های هوش مصنوعی با داده‌های مشتری و بسته سیاست‌های اعتماد روکسیرا (Trust Pack).",
};

interface TrustDoc {
  titleFa: string;
  titleEn: string;
  code: string;
  descFa: string;
  descEn: string;
}

const TRUST_POLICIES: TrustDoc[] = [
  {
    titleFa: "سیاست کنترل دسترسی",
    titleEn: "Access Control Policy",
    code: "POL-SEC-001",
    descFa: "الزام دسترسی بر پایه نقش (RBAC)، اصل حداقل اختیارات، احراز هویت دوعاملی سخت‌گیرانه (Passkeys و TOTP) و چرخه عمر حساب‌ها.",
    descEn: "Role-based access control, least privilege enforcement, mandatory MFA via WebAuthn passkeys/TOTP, and access auditing.",
  },
  {
    titleFa: "سیاست حفاظت از داده‌ها و رمزنگاری",
    titleEn: "Data Protection & Encryption Policy",
    code: "POL-SEC-002",
    descFa: "ایزولاسیون صددرصدی مستأجران با FORCE Row-Level Security در PostgreSQL، رمزنگاری داده‌ها در حال استراحت (AES-256) و در حال انتقال (TLS 1.3).",
    descEn: "100% PostgreSQL FORCE RLS tenant isolation, AES-256 at rest, TLS 1.3 in transit, and secure cryptographic key management.",
  },
  {
    titleFa: "سیاست مدیریت آسیب‌پذیری‌ها",
    titleEn: "Vulnerability Management Policy",
    code: "POL-SEC-003",
    descFa: "پایش مداوم CI/CD با Trivy، Semgrep، Gitleaks و Squawk، زمان‌بندی رفع آسیب‌پذیری بحرانی ظرف ۴۸ ساعت و برنامه افشای مسئولانه.",
    descEn: "Continuous CI/CD scanning (Trivy, Semgrep, Gitleaks), strict SLA (critical <= 48h), and vulnerability disclosure program.",
  },
  {
    titleFa: "سیاست مدیریت حوادث امنیتی",
    titleEn: "Incident Management Policy",
    code: "POL-SEC-004",
    descFa: "دستورالعمل واکنش به حوادث، پایش خطای متمرکز و تعهد رسمی به اطلاع‌رسانی به مشتریان ظرف ۴۸ ساعت پس از تایید رخداد امنیتی.",
    descEn: "Incident response runbook, automated alerting, and contractual 48-hour breach notification SLA.",
  },
  {
    titleFa: "سیاست تداوم کسب‌وکار و بازیابی فاجعه",
    titleEn: "Business Continuity & DR Policy",
    code: "POL-SEC-005",
    descFa: "اهداف پایداری سیستم با RPO کمتر از ۱۵ دقیقه و RTO کمتر از ۲ ساعت، پشتیبان‌گیری تغییرناپذیر Object Lock و مانورهای فصلی بازیابی.",
    descEn: "RPO < 15 min, RTO < 2 hours, continuous WAL streaming, immutable Object Lock backups, and quarterly restore rehearsals.",
  },
  {
    titleFa: "سیاست نظارت بر تامین‌کنندگان و پردازشگران فرعی",
    titleEn: "Vendor & Sub-Processor Policy",
    code: "POL-SEC-006",
    descFa: "پیمان‌نامه‌های صریح عدم استفاده از داده‌های کاربران برای آموزش مدل‌های هوش مصنوعی (Zero Training)، انطباق با قراردادهای DPA و لیست شفاف پردازشگران.",
    descEn: "Strict no-training AI processing guarantees, DPA governance, and public, versioned sub-processor registry.",
  },
];

export default function SecurityTrustPage() {
  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {/* سربرگ معرفی */}
        <section className="space-y-4 text-center sm:text-right">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <span>🛡️</span>
            <span>بسته اعتماد سازمانی و امنیت روکسیرا (Trust Pack v1)</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            مرکز امنیت و حاکمیت بر داده‌های سازمانی
          </h1>
          <p className="text-xs sm:text-base text-slate-300 max-w-3xl leading-relaxed">
            امنیت، حفظ اسرار تجاری و ایزولاسیون کامل داده‌های مالی و حقوقی سازمان‌ها سنگ‌بنای معماری پلتفرم روکسیرا است. در این صفحه جزئیات معماری دفاع در عمق، تضامین حقوقی و استانداردهای پایش پیوسته سامانه ارائه شده است.
          </p>
        </section>

        {/* ارکان چهارگانه امنیت */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <span className="text-xl">🔒</span>
              <h2 className="text-base font-bold text-white">ایزولاسیون مستأجران در سطح پایگاه داده (FORCE RLS)</h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              صد درصد جداول تجاری و مالی پایگاه داده دارای مکانیزم <code>FORCE ROW LEVEL SECURITY</code> در هسته PostgreSQL هستند. تمام درخواست‌های اپلیکیشن با نقش غیرممتاز <code>roxira_app</code> اجرا می‌شوند و خواندن یا نوشتن داده‌های سازمانی دیگر در سطح کرنل پایگاه داده ناممکن است.
            </p>
          </article>

          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <span className="text-xl">🧠</span>
              <h2 className="text-base font-bold text-white">عدم آموزش هوش مصنوعی با داده‌های مشتری (Zero Training)</h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              داده‌های مالی، حقوقی و اسناد بارگذاری‌شده مشتریان هرگز برای آموزش یا بهینه‌سازی مدل‌های عمومی هوش مصنوعی مصرف نمی‌شوند. درخواست‌ها از طریق رابط‌های سازمانی با تضمین اکید عدم ثبت (Zero Data Retention) هدایت می‌گردند.
            </p>
          </article>

          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <span className="text-xl">🔑</span>
              <h2 className="text-base font-bold text-white">احراز هویت نوین و ورود دوعاملی (Passkeys / WebAuthn)</h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              پشتیبانی بومی از سخت‌افزارهای امنیتی FIDO2 و کلیدهای دیجیتال Passkey برای حذف کامل حملات فیشینگ گذرواژه. همراه با انقضای کوتاه‌مدت توکن‌های دسترسی و نظارت پیوسته بر زنجیره توکن‌های نوسازی.
            </p>
          </article>

          <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <span className="text-xl">📜</span>
              <h2 className="text-base font-bold text-white">ردیابی تغییرناپذیر رخدادها (Immutable Audit Logs)</h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              کلیه تراکنش‌های مالی، ورودهای سیستمی و تغییرات دسترسی با چک‌سام‌های رمزنگاری‌شده ثبت می‌شوند. <strong>هدف خط مشی ما نگهداری ۱۲ ماهه گزارش‌های حسابرسی است</strong> (12 months is our target retention policy; automated enforcement is not yet in place).
            </p>
          </article>
        </div>

        {/* بسته سیاست‌های امنیتی */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold text-white">سیاست‌های شش‌گانه امنیت اطلاعات (Security Policies)</h2>
            <span className="text-xs text-slate-400 font-mono">docs/security/policies</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {TRUST_POLICIES.map((p) => (
              <div key={p.code} className="bg-slate-900/40 border border-slate-800/80 p-4 sm:p-5 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-md border border-emerald-500/20">
                    {p.code}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">{p.titleEn}</span>
                </div>
                <h3 className="text-sm font-bold text-slate-100">{p.titleFa}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{p.descFa}</p>
              </div>
            ))}
          </div>
        </section>

        {/* استانداردها و ارزیابی انطباق */}
        <section className="bg-slate-900/70 border border-slate-800 p-6 rounded-2xl space-y-4">
          <h2 className="text-lg font-bold text-white">پاسخ‌نامه استاندارد و خوداظهاری Cloud Security Alliance (CSA)</h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            جهت تسریع فرآیند ارزیابی ریسک امنیتی توسط مدیران فناوری و افسران امنیت سازمان‌های مشتری، خوداظهاری رسمی بر پایه پرسش‌نامه CAIQ v4 Lite اتحادیه امنیت ابری (CSA STAR Level 1) تکمیل و منتشر شده است:
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200 border border-slate-700">
              <span>📋</span> CSA CAIQ v4 Lite Compliant
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200 border border-slate-700">
              <span>🔐</span> GDPR & Article 33 Breach SLA
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200 border border-slate-700">
              <span>📁</span> ISO 27001 Datacentre Hosting
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-200 border border-slate-700">
              <span>⏱️</span> 12 Months Audit Log Retention
            </span>
          </div>
        </section>

        {/* تماس امنیت و گزارش باگ */}
        <section className="border-t border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div>
            گزارش‌های آسیب‌پذیری و ارزیابی امنیتی:{" "}
            <a href="mailto:security@roxira.com" className="text-emerald-400 underline font-mono">
              security@roxira.com
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-slate-200 transition-colors">
              حریم خصوصی
            </Link>
            <span>•</span>
            <Link href="/terms" className="hover:text-slate-200 transition-colors">
              قوانین و مقررات
            </Link>
            <span>•</span>
            <Link href="/contact" className="hover:text-slate-200 transition-colors">
              تماس با ما
            </Link>
          </div>
        </section>
      </main>

      <EnamadFooter />
    </div>
  );
}
