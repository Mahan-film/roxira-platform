import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";
import { SubscriptionCta } from "@/components/judge/subscription/subscription-cta";
import { formatPersianNumber } from "@/components/judge/subscription/types";
import { loadPlans, type PlanLimits } from "@/lib/plans-data";

// Prices are read from the API at request time and cached for a few minutes; the build
// must never freeze a "backend unreachable" state into the page.
export const dynamic = "force-dynamic";

const TITLE = "اشتراک و قیمت‌ها | قاضی هوشمند";
const DESCRIPTION = "قیمت‌ها و امکانات هر طرح قاضی هوشمند؛ مهمان، کاربر واردشده و اشتراک VIP، با اعداد واقعی سامانه.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/plans" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "https://ghazihoushmand.ir/plans", siteName: "قاضی هوشمند", locale: "fa_IR", type: "website" },
};

const DRAFT_LABELS: Record<string, string> = {
  defense: "لایحه دفاعیه",
  petition: "دادخواست",
  complaint: "شکواییه",
  notice: "اظهارنامه",
  ruling: "پیش‌نویس رأی",
  indictment: "کیفرخواست",
};

const fa = (n: number) => formatPersianNumber(n);

function perHour(n: number | null): string {
  return n === null ? "سقف ساعتی خاصی اعمال نمی‌شود" : `تا ${fa(n)} بار در ساعت`;
}

function perChatDay(n: number | null): string {
  return n === null ? "—" : `تا ${fa(n)} پرسش در روز`;
}

function perDay(n: number | null): string {
  if (n === null) return "—";
  return n === 0 ? "نیاز به ورود دارد" : `تا ${fa(n)} فایل در روز`;
}

function drafts(list: string[]): string {
  return list.length ? list.map((t) => DRAFT_LABELS[t] ?? t).join("، ") : "—";
}

function buildRows(l: PlanLimits): Array<{ label: string; cells: [string, string, string] }> {
  return [
    {
      label: "پیام متنی",
      cells: [
        `تا ${fa(l.chat_messages_per_hour.guest ?? 0)} پیام در ساعت`,
        perHour(l.chat_messages_per_hour.free),
        perHour(l.chat_messages_per_hour.vip),
      ],
    },
    ...(l.chat_messages_per_day
      ? [
          {
            label: "پرسش در روز",
            cells: [
              perChatDay(l.chat_messages_per_day.guest),
              perChatDay(l.chat_messages_per_day.free),
              perChatDay(l.chat_messages_per_day.vip),
            ] as [string, string, string],
          },
        ]
      : []),
    {
      label: "صدا (میکروفون و مکالمه زنده)",
      cells: [perHour(l.voice_requests_per_hour.guest), perHour(l.voice_requests_per_hour.free), perHour(l.voice_requests_per_hour.vip)],
    },
    {
      label: "بارگذاری فایل پرونده",
      cells: [perDay(l.file_uploads_per_day.guest), perDay(l.file_uploads_per_day.free), perDay(l.file_uploads_per_day.vip)],
    },
    {
      label: "پیش‌نویس",
      cells: [drafts(l.draft_types.guest), drafts(l.draft_types.free), drafts(l.draft_types.vip)],
    },
  ];
}

export default async function PlansPage() {
  const data = await loadPlans();
  const single = data?.plans?.SINGLE_DRAFT;
  const vip = data?.plans?.VIP_MONTHLY_PRO;
  const rows = data ? buildRows(data.limits) : [];
  const vipOnlyList = data?.limits.vip_only_draft_types ?? [];
  const vipIncludes = vipOnlyList.length ? `شامل ${drafts(vipOnlyList)} و سقف بالاتر بارگذاری فایل.` : "شامل سقف بالاتر بارگذاری فایل.";

  return (
    <div className="ap-theme min-h-screen" data-theme="dark" dir="rtl" lang="fa">
      <GhaziHeader />
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-10">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold">اشتراک و قیمت‌ها</h1>
          <p className="ap-muted leading-7">
            گفتگوی حقوقی با ورود یا بدون ورود در دسترس است. اشتراک VIP برای کسانی است که به پیش‌نویس رأی و کیفرخواست و سقف بالاتر بارگذاری فایل نیاز دارند. پاسخ‌ها راهنمای اولیه‌اند و جای مشاوره با وکیل را نمی‌گیرند.
          </p>
        </header>

        {(!data || !single || !vip) && (
          <p className="ap-card ap-muted" role="status">
            {data ? "دریافت قیمت‌ها اکنون ممکن نشد." : "دریافت قیمت‌ها و امکانات اکنون ممکن نشد."} چند دقیقه دیگر دوباره سر بزنید.
          </p>
        )}

        {data && (
          <>
            {single && vip && (
            <section aria-labelledby="prices-h" className="space-y-4">
              <h2 id="prices-h" className="text-lg font-semibold">قیمت‌ها</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {single && (
                  <article className="ap-card space-y-2">
                    <h3 className="font-semibold">یک لایحهٔ تخصصی</h3>
                    <p className="text-2xl font-semibold">{fa(single.price_toman)} <span className="ap-muted text-sm font-normal">تومان</span></p>
                    <p className="ap-muted text-sm leading-6">پرداخت یک‌بار برای یک لایحه، بدون اشتراک ماهانه.</p>
                  </article>
                )}
                {vip && (
                  <article className="ap-card space-y-2">
                    <h3 className="font-semibold">اشتراک VIP ماهانه</h3>
                    <p className="text-2xl font-semibold">{fa(vip.price_toman)} <span className="ap-muted text-sm font-normal">تومان در ماه</span></p>
                    <p className="ap-muted text-sm leading-6">{vipIncludes}</p>
                  </article>
                )}
              </div>
              <SubscriptionCta label="خرید اشتراک یا لایحه" className="ap-btn w-full sm:w-auto" />
              <p className="ap-muted text-[13px] leading-6">
                پرداخت از درگاه زیبال انجام می‌شود. مبلغ نهایی پیش از انتقال به درگاه در پنجرهٔ خرید دوباره نشان داده می‌شود.
              </p>
            </section>
            )}

            <section aria-labelledby="compare-h" className="space-y-4">
              <h2 id="compare-h" className="text-lg font-semibold">مقایسهٔ امکانات</h2>
              <div className="overflow-x-auto rounded-2xl" style={{ background: "var(--ap-surface)" }} tabIndex={0} role="region" aria-label="جدول مقایسه (قابل پیمایش)">
                <table className="w-full min-w-[34rem] text-start text-sm">
                  <thead>
                    <tr className="ap-muted">
                      <th scope="col" className="px-4 py-3 text-start font-medium">امکان</th>
                      <th scope="col" className="px-4 py-3 text-start font-medium">مهمان</th>
                      <th scope="col" className="px-4 py-3 text-start font-medium">واردشده</th>
                      <th scope="col" className="px-4 py-3 text-start font-medium">VIP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} style={{ borderTop: "1px solid var(--ap-line)" }}>
                        <th scope="row" className="px-4 py-3 text-start font-medium align-top">{row.label}</th>
                        {row.cells.map((c, i) => (
                          <td key={i} className="px-4 py-3 align-top leading-6">{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="ap-muted list-disc space-y-1 pe-5 text-[13px] leading-6">
                <li>هر پیام تا {fa(data.limits.max_message_chars)} نویسه.</li>
                <li>هر فایل تا {fa(data.limits.max_file_mb)} مگابایت و {fa(data.limits.max_pages_per_file)} صفحه؛ در هر گفتگو تا {fa(data.limits.max_files_per_chat)} فایل.</li>
                <li>این اعداد مستقیم از تنظیمات سامانه خوانده می‌شوند؛ اگر تغییر کنند، همین صفحه هم به‌روز می‌شود.</li>
              </ul>
            </section>
          </>
        )}

        <p className="ap-muted text-[13px] leading-6">
          پوشش قوانین محدود است؛ فهرست آن را در <Link href="/coverage" className="ap-link underline">صفحهٔ پوشش قوانین</Link> ببینید. جزئیات بیشتر در <Link href="/guide" className="ap-link underline">راهنما</Link>.
        </p>
      </main>
      <EnamadFooter />
    </div>
  );
}
