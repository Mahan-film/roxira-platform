import type { Metadata } from "next";
import Link from "next/link";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";
import { SubscriptionCta } from "@/components/judge/subscription/subscription-cta";
import { PlanCards } from "@/components/judge/subscription/plan-cards";
import { formatPersianNumber } from "@/components/judge/subscription/types";
import { LEVEL_COPY, PLAN_LEVELS, draftsText, planKey } from "@/lib/plan-catalog";
import { loadPlans, type PlanLimits } from "@/lib/plans-data";

// Prices are read from the API at request time and cached for a few minutes; the build
// must never freeze a "backend unreachable" state into the page.
export const dynamic = "force-dynamic";

const TITLE = "اشتراک و قیمت‌ها | قاضی هوشمند";
const DESCRIPTION = "قیمت‌ها و امکانات هر طرح قاضی هوشمند؛ رایگان، پایه، حرفه‌ای و ویژه، با اعداد واقعی سامانه.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://ghazihoushmand.ir/plans" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "https://ghazihoushmand.ir/plans", siteName: "قاضی هوشمند", locale: "fa_IR", type: "website" },
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

const drafts = (list: string[] | undefined) => draftsText(list);

type Row = { label: string; cells: [string, string, string, string] };

function buildRows(l: PlanLimits): Row[] {
  const day = l.chat_messages_per_day;
  const dayFree = day ? `مهمان ${fa(day.guest ?? 0)} / واردشده ${fa(day.free ?? 0)} پرسش` : "—";
  const top = l.top_model_answers_per_day;
  return [
    {
      label: "کیفیت مدل",
      cells: [LEVEL_COPY.free.model, LEVEL_COPY.basic.model, LEVEL_COPY.pro.model, LEVEL_COPY.premium.model],
    },
    ...(day
      ? [
          {
            label: "پرسش در روز",
            cells: [dayFree, perChatDay(day.basic ?? null), perChatDay(day.pro ?? null), perChatDay(day.premium ?? null)] as Row["cells"],
          },
        ]
      : []),
    ...(top
      ? [
          {
            label: "پاسخ با بهترین مدل هر طرح در روز",
            cells: ["—", "—", top.pro != null ? `${fa(top.pro)} پاسخ` : "—", top.premium != null ? `${fa(top.premium)} پاسخ` : "—"] as Row["cells"],
          },
        ]
      : []),
    {
      label: "صدا (میکروفون و مکالمه زنده)",
      cells: [
        perHour(l.voice_requests_per_hour.free),
        perHour(l.voice_requests_per_hour.basic ?? null),
        perHour(l.voice_requests_per_hour.pro ?? null),
        perHour(l.voice_requests_per_hour.premium ?? null),
      ],
    },
    {
      label: "بارگذاری فایل پرونده",
      cells: [
        perDay(l.file_uploads_per_day.free),
        perDay(l.file_uploads_per_day.basic ?? null),
        perDay(l.file_uploads_per_day.pro ?? null),
        perDay(l.file_uploads_per_day.premium ?? null),
      ],
    },
    {
      label: "پیش‌نویس",
      cells: [drafts(l.draft_types.free), drafts(l.draft_types.basic), drafts(l.draft_types.pro), drafts(l.draft_types.premium)],
    },
  ];
}

export default async function PlansPage() {
  const data = await loadPlans();
  const single = data?.plans?.SINGLE_DRAFT;
  const hasTiers = Boolean(data && PLAN_LEVELS.some((lv) => lv !== "free" && data.plans?.[planKey(lv, "monthly")]));
  const rows = data ? buildRows(data.limits) : [];

  return (
    <div className="ap-theme ghazi-theme min-h-screen" data-theme="dark" dir="rtl" lang="fa">
      <GhaziHeader />
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-10">
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold">اشتراک و قیمت‌ها</h1>
          <p className="ap-muted leading-7">
            گفتگوی حقوقی با ورود یا بدون ورود رایگان در دسترس است. اشتراک‌های پایه، حرفه‌ای و ویژه پاسخ‌های بیشتر با مدل‌های قوی‌تر می‌دهند؛ پیش‌نویس رأی و کیفرخواست از طرح حرفه‌ای به بالا فعال است. پاسخ‌ها راهنمای اولیه‌اند و جای مشاوره با وکیل را نمی‌گیرند.
          </p>
        </header>

        {(!data || !hasTiers) && (
          <p className="ap-card ap-muted" role="status">
            {data ? "دریافت قیمت‌ها اکنون ممکن نشد." : "دریافت قیمت‌ها و امکانات اکنون ممکن نشد."} چند دقیقه دیگر دوباره سر بزنید.
          </p>
        )}

        {data && (
          <>
            {hasTiers && data && (
              <section aria-labelledby="prices-h" className="space-y-4">
                <h2 id="prices-h" className="text-lg font-semibold">طرح‌ها و قیمت‌ها</h2>
                <PlanCards plans={data.plans} limits={data.limits} />
                <p className="ap-muted text-[13px] leading-6">
                  پرداخت از درگاه زیبال انجام می‌شود. مبلغ نهایی پیش از انتقال به درگاه در پنجرهٔ خرید دوباره نشان داده می‌شود.
                </p>
              </section>
            )}

            {single && (
              <section aria-labelledby="oneoff-h" className="space-y-4">
                <h2 id="oneoff-h" className="text-lg font-semibold">خرید یک‌باره</h2>
                <article className="ap-card space-y-2">
                  <h3 className="font-semibold">یک لایحهٔ تخصصی</h3>
                  <p className="text-2xl font-semibold">{fa(single.price_toman)} <span className="ap-muted text-sm font-normal">تومان</span></p>
                  <p className="ap-muted text-sm leading-6">پرداخت یک‌بار برای یک لایحه، بدون اشتراک.</p>
                  <SubscriptionCta label="خرید لایحه" className="ap-btn" />
                </article>
              </section>
            )}

            <section aria-labelledby="compare-h" className="space-y-4">
              <h2 id="compare-h" className="text-lg font-semibold">مقایسهٔ امکانات</h2>
              <div className="overflow-x-auto rounded-2xl" style={{ background: "var(--ap-surface)" }} tabIndex={0} role="region" aria-label="جدول مقایسه (قابل پیمایش)">
                <table className="w-full min-w-[40rem] text-start text-sm">
                  <thead>
                    <tr className="ap-muted">
                      <th scope="col" className="px-4 py-3 text-start font-medium">امکان</th>
                      {PLAN_LEVELS.map((lv) => (
                        <th key={lv} scope="col" className="px-4 py-3 text-start font-medium">{LEVEL_COPY[lv].title}</th>
                      ))}
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
