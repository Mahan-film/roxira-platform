import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GhaziHeader } from "@/components/layout/ghazi-header";
import { EnamadFooter } from "@/components/layout/enamad-footer";

export const metadata: Metadata = {
  title: "حریم خصوصی | سامانه هوشمند قاضی هوشمند",
  description:
    "چه داده‌ای جمع می‌کنیم، پیام‌های شما به کدام سرویس‌های هوش مصنوعی و پردازشگرها می‌رود و چه حقوقی دارید. Privacy policy of Ghazi Houshmand and Roxira.",
};

// Keep this page in sync with what the code does (AGENTS.md section 4: free models first, and
// free tiers may log). Last audit: 2026-10-22 (key pool config/key_pool.yaml, Cloudflare proxy +
// Workers AI embeddings, Kavenegar, Zibal, TRON, edge-tts, Telegram backups, R2, Umami).

type Processor = { name: string; fa: string; en: string };

const PROCESSORS: Processor[] = [
  {
    name: "Hetzner",
    fa: "میزبانی سرورها و پایگاه داده (اروپا). همهٔ داده‌های حساب و گفتگوها آنجا نگهداری می‌شود.",
    en: "Server and database hosting (Europe). Account data and chat history are stored there.",
  },
  {
    name: "Cloudflare",
    fa: "DNS و پروکسی/CDN: همهٔ ترافیک سایت از Cloudflare عبور می‌کند. متن پرسش برای جست‌وجوی قوانین به Workers AI فرستاده می‌شود. پشتیبان‌های رمزگذاری‌شده ممکن است در R2 نگهداری شوند.",
    en: "DNS and proxy/CDN: all site traffic passes through Cloudflare. Your question is sent to Workers AI to search the laws. Encrypted backups may be stored in R2.",
  },
  {
    name: "OpenRouter",
    fa: "دروازهٔ مدل‌های هوش مصنوعی (از جمله Anthropic، DeepSeek، Google، Moonshot، Z.ai، Qwen، OpenAI، NVIDIA، Xiaomi و مدل‌های رایگان؛ پیام شما به همان ارائه‌دهندهٔ بالادستی مدل می‌رسد)، تبدیل گفتار به متن و خواندن اسناد بارگذاری‌شده.",
    en: "AI model gateway (including Anthropic, DeepSeek, Google, Moonshot, Z.ai, Qwen, OpenAI, NVIDIA, Xiaomi and free models; your message reaches that model's upstream provider), speech-to-text and reading uploaded documents.",
  },
  {
    name: "Groq, Google (Gemini API), Mistral AI, SambaNova",
    fa: "مدل‌های رایگانی که پاسخ کاربران رایگان را می‌سازند و پشتیبان مدل‌های پولی‌اند. نسخه‌های رایگان این سرویس‌ها ممکن است پیام‌ها را ثبت کنند یا برای بهبود مدل‌هایشان به کار ببرند.",
    en: "Free models that answer free users and back up the paid models. The free tiers of these services may log prompts or use them to improve their models.",
  },
  {
    name: "AssemblyAI",
    fa: "تبدیل گفتار به متن در حالت صوتی: فایل صدای شما برای تبدیل به متن به این سرویس فرستاده می‌شود.",
    en: "Speech-to-text in voice mode: your audio is sent to this service to be transcribed.",
  },
  {
    name: "Microsoft (Edge read-aloud)",
    fa: "تبدیل متن پاسخ به صدا در حالت گفتگوی صوتی.",
    en: "Turns the answer text into speech in voice mode.",
  },
  {
    name: "Kavenegar",
    fa: "ارسال پیامک کد ورود (شمارهٔ موبایل شما).",
    en: "Sends the login SMS code (your mobile number).",
  },
  {
    name: "Zibal",
    fa: "درگاه پرداخت ریالی. اطلاعات کارت را در صفحهٔ زیبال وارد می‌کنید و به دست ما نمی‌رسد؛ ما مبلغ، شمارهٔ سفارش و رسید را نگه می‌داریم.",
    en: "Rial payment gateway. You enter card details on Zibal's page; we never see them. We keep the amount, order id and receipt.",
  },
  {
    name: "TRON (USDT)",
    fa: "پرداخت تتری روی بلاک‌چین ترون انجام می‌شود و تراکنش آن برای همه قابل مشاهده است.",
    en: "USDT payments run on the TRON blockchain, where every transaction is public.",
  },
  {
    name: "Telegram",
    fa: "پشتیبان روزانهٔ پایگاه داده پیش از ارسال رمزگذاری می‌شود و کلید آن فقط نزد مدیر سامانه و بیرون از سرور است. هشدارهای فنی هم بدون شماره و متن پیام به مدیر می‌رسد.",
    en: "The daily database backup is encrypted before upload and its key is kept offline by the operator. Operational alerts to the operator carry no phone numbers or message text.",
  },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-3">
      <h2 className="text-sm sm:text-base font-bold text-amber-400">{title}</h2>
      {children}
    </article>
  );
}

export default function PrivacyPage() {
  return (
    <div className="dark glass-app-bg flex flex-col min-h-screen text-foreground font-sans" dir="rtl">
      <GhaziHeader />

      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <section className="space-y-3 text-center sm:text-right">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
            <span>🔒</span>
            <span>حریم خصوصی، بدون اغراق</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">سیاست حفظ حریم خصوصی</h1>
          <p className="text-xs sm:text-sm text-slate-400">
            قاضی هوشمند (ghazihoushmand.ir) و روکسیرا (roxira.ir). آخرین بازبینی: ۳۰ مهر ۱۴۰۵.
          </p>
        </section>

        <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <article className="bg-amber-500/10 border border-amber-500/40 p-5 sm:p-6 rounded-2xl space-y-2">
            <h2 className="text-sm sm:text-base font-bold text-amber-300">خلاصه</h2>
            <p>
              برای ساختن پاسخ، پیام شما و فایل‌هایی که می‌فرستید به سرویس‌های هوش مصنوعی بیرونی فرستاده می‌شود. کاربران رایگان
              فقط با مدل‌های رایگان پاسخ می‌گیرند و مدل‌های پولی هم در صورت خطا به همین مدل‌های رایگان برمی‌گردند؛ ارائه‌دهندگان
              مدل‌های رایگان ممکن است پیام‌ها را ثبت کنند یا برای آموزش مدل‌هایشان استفاده کنند. سامانه در مرحلهٔ آزمایشی است:
              اطلاعات محرمانه وارد نکنید و نام‌ها، شماره‌ها و نشانی‌ها را پیش از ارسال حذف یا جایگزین کنید.
            </p>
          </article>

          <Section title="۱. چه داده‌ای جمع می‌کنیم">
            <ul className="list-disc pr-5 space-y-1.5">
              <li>شمارهٔ موبایل (ورود با پیامک) یا ایمیل و رمز عبور (رمز به‌صورت درهم‌شده نگهداری می‌شود).</li>
              <li>پیام‌ها، پاسخ‌ها و تاریخچهٔ گفتگو، و متن فایل‌ها و تصاویری که بارگذاری می‌کنید.</li>
              <li>صدای شما در حالت صوتی فقط برای تبدیل به متن استفاده می‌شود و فایل صوتی نگهداری نمی‌شود؛ متن آن در گفتگو می‌ماند.</li>
              <li>اشتراک، سفارش‌ها و رسیدهای پرداخت.</li>
              <li>
                گزارش‌های فنی (نشانی IP برای محدودیت تعداد درخواست، زمان پاسخ، مدل و هزینهٔ هر پاسخ). متن پیام و شماره در این
                گزارش‌ها ثبت نمی‌شود.
              </li>
              <li>
                آمار بازدید با Umami روی سرور خودمان، بدون کوکی: صفحه‌ها و رویدادهایی مانند «شروع گفتگو» یا «پرداخت موفق»، بدون
                متن پیام و شماره.
              </li>
            </ul>
          </Section>

          <Section title="۲. پیام شما به کجا می‌رود">
            <p>
              پیام همراه با مواد قانونی مرتبط به یک مدل زبانی فرستاده می‌شود. مسیر به نوع اشتراک بستگی دارد:
            </p>
            <ul className="list-disc pr-5 space-y-1.5">
              <li>
                <strong className="text-slate-100">کاربر مهمان و رایگان:</strong> فقط مدل‌های رایگان (Groq، Google Gemini، Mistral و
                مدل‌های رایگان OpenRouter). این ارائه‌دهندگان ممکن است پیام را ثبت کنند یا برای بهبود مدل‌ها به کار ببرند.
              </li>
              <li>
                <strong className="text-slate-100">اشتراک پولی:</strong> ابتدا مدل‌های پولی از طریق OpenRouter؛ اگر در دسترس نباشند،
                پاسخ با همان مدل‌های رایگان ساخته می‌شود.
              </li>
              <li>
                خواندن فایل‌ها و تصاویر پرونده (استخراج متن) فقط با مدل‌های پولی و با درخواست «عدم نگهداری داده» از ارائه‌دهنده
                انجام می‌شود؛ متن استخراج‌شده سپس مانند پیام شما از همان مسیر بالا به مدل پاسخ‌دهنده می‌رسد.
              </li>
              <li>متن پرسش برای یافتن قوانین مرتبط به Cloudflare Workers AI فرستاده می‌شود.</li>
              <li>
                در روکسیرا (roxira.ir/app)، «ورود هوشمند داده» نام ستون‌ها و چند ردیف نمونه از فایل شما، و در صورت بارگذاری PDF یا
                عکس خود فایل را، با مدل پولی و درخواست «عدم نگهداری داده» به OpenRouter می‌فرستد.
              </li>
            </ul>
            <p>
              ما پیام‌های شما را نمی‌فروشیم و خودمان با آن‌ها مدلی آموزش نمی‌دهیم. اما سیاست ارائه‌دهندگان بیرونی در اختیار ما نیست؛
              به همین دلیل نمی‌توانیم قول دهیم که هیچ‌کدام از آن‌ها پیام را نگه ندارد.
            </p>
          </Section>

          <Section title="۳. پردازشگرهای بیرونی">
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-100">
                    <th scope="col" className="py-2 pl-3 font-semibold">سرویس</th>
                    <th scope="col" className="py-2 font-semibold">کاربرد و داده</th>
                  </tr>
                </thead>
                <tbody>
                  {PROCESSORS.map((p) => (
                    <tr key={p.name} className="border-b border-slate-800 align-top">
                      <td className="py-2 pl-3 whitespace-nowrap font-medium text-slate-100" dir="ltr">
                        {p.name}
                      </td>
                      <td className="py-2">{p.fa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>ایمیل‌ها از سرور ایمیل خودمان ارسال می‌شوند و آمار بازدید (Umami) هم روی سرور خودمان است.</p>
          </Section>

          <Section title="۴. امنیت">
            <p>
              ارتباط مرورگر با سایت رمزگذاری‌شده (HTTPS) است و از Cloudflare می‌گذرد. دسترسی به داده‌ها محدود به مدیر سامانه است
              و پشتیبان‌ها پیش از خروج از سرور رمزگذاری می‌شوند. هیچ سامانه‌ای کاملاً بی‌خطر نیست.
            </p>
          </Section>

          <Section title="۵. نگهداری و حقوق شما">
            <p>
              تاریخچهٔ گفتگو تا زمانی که درخواست حذف ندهید نگهداری می‌شود. برای دریافت یا حذف داده‌های حساب و گفتگوها با پشتیبانی
              به شماره <a href="tel:09129367796" className="text-amber-400 font-mono font-bold">09129367796</a> تماس بگیرید. دادهٔ حذف‌شده
              ممکن است تا چرخش پشتیبان‌های رمزگذاری‌شده در آن‌ها باقی بماند. داده‌ای که پیش‌تر به ارائه‌دهندگان مدل رسیده تابع
              سیاست همان ارائه‌دهنده است.
            </p>
          </Section>

          <section lang="en" dir="ltr" className="bg-slate-900/60 border border-slate-800 p-5 sm:p-6 rounded-2xl space-y-4 text-left">
            <h2 className="text-base sm:text-lg font-bold text-amber-400">Privacy policy (English)</h2>
            <p className="text-slate-400">Ghazi Houshmand (ghazihoushmand.ir) and Roxira (roxira.ir). Last reviewed 2026-10-22.</p>
            <p>
              <strong className="text-slate-100">In short:</strong> to answer you, your messages and files are sent to external AI
              providers. Free users are answered by free models only, and paid plans fall back to the same free models when the
              paid ones fail. Free-tier providers may log prompts or use them to train their models. The service is in a test
              phase: do not enter confidential information, and remove or replace names, numbers and addresses before sending.
            </p>
            <h3 className="font-semibold text-slate-100">What we collect</h3>
            <p>
              Mobile number (SMS login) or e-mail and a hashed password; messages, answers, chat history and the text of files and
              images you upload; voice is only transcribed and the audio is not kept; subscriptions, orders and receipts;
              technical logs (IP address for rate limits, timings, model and cost per answer, never message text or phone
              numbers); cookieless self-hosted Umami analytics (pages and events such as &ldquo;chat started&rdquo;, no message
              text or phone numbers).
            </p>
            <h3 className="font-semibold text-slate-100">Where your message goes</h3>
            <p>
              Guests and free users: free models only (Groq, Google Gemini, Mistral and free OpenRouter models). Paid plans: paid
              models through OpenRouter first, then the free models as a fallback. Text is extracted from uploaded case files and images
              by paid models only, with a no-data-retention request to the provider; the extracted text then follows the same
              route as your messages. Your question is sent to Cloudflare Workers AI to find
              the relevant laws. In Roxira (roxira.ir/app), the AI data import sends your column names and a few sample rows (or
              the PDF or photo itself) to a paid model through OpenRouter with a no-data-retention request. We do not sell your messages or train our own models on them, but we do not control the
              providers&rsquo; policies, so we cannot promise that none of them keeps a copy.
            </p>
            <h3 className="font-semibold text-slate-100">Processors</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              {PROCESSORS.map((p) => (
                <li key={p.name}>
                  <strong className="text-slate-100">{p.name}:</strong> {p.en}
                </li>
              ))}
              <li>E-mail is sent from our own mail server; analytics (Umami) also runs on our own server.</li>
            </ul>
            <h3 className="font-semibold text-slate-100">Security, retention and your rights</h3>
            <p>
              Traffic is encrypted (HTTPS) and passes through Cloudflare; data access is limited to the operator and backups are
              encrypted before they leave the server. No system is perfectly safe.
              Chat history is kept until you ask us to delete it: call support at{" "}
              <a href="tel:09129367796" className="text-amber-400 font-mono font-bold">09129367796</a> to get a copy of your data or
              delete it. Deleted data can remain in encrypted backups until they rotate out; data already sent to a model provider
              is subject to that provider&rsquo;s policy.
            </p>
          </section>
        </div>

        <div className="text-center pt-4">
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs sm:text-sm transition-colors"
          >
            <span>بازگشت به محیط مشاوره قاضی هوشمند</span>
            <span>⚖️</span>
          </Link>
        </div>
      </main>

      <EnamadFooter />
    </div>
  );
}
