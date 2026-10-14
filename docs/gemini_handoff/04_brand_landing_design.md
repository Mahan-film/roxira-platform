# Prompt 4 — Brand landing page design for «قاضی هوشمند»

Attach 2–3 screenshots of the current ghazihoushmand.ir (home/chat) on desktop and mobile.

---

You are a senior product designer and Next.js engineer. Design a new landing page for «قاضی هوشمند», a Persian (RTL) legal-AI assistant. Audience: ordinary Iranians with a legal problem, plus lawyers. Tone: trustworthy, calm, modern; not "techy".

Deliver in ONE answer:
1. **Page structure** (sections in order) with the exact Persian copy for each: hero (headline ≤8 words, sub-headline, primary CTA «سؤال حقوقی‌ات را بپرس» → /chat, secondary CTA «قوانین را بخوان» → /laws), how it works (3 steps), what it can do (6 cards: مشاوره، تنظیم لایحه و دادخواست، تحلیل پرونده با بارگذاری مدارک، جستجوی قوانین و آرای وحدت رویه، تشخیص دادگاه صالح، محاسبه مهلت‌ها), trust section (sources: متن رسمی قوانین با لینک منبع، آرای وحدت رویه، هشدار «جایگزین وکیل نیست»), pricing teaser → /plans, FAQ (6 Q&A), footer.
2. **Design tokens**: colour palette (with hex, light AND dark mode), typography (use Vazirmatn, sizes scale), spacing, radii, shadows.
3. **Code**: a single React server component `LandingPage.tsx` for Next.js App Router using Tailwind CSS only (no new npm packages), RTL with logical properties (ms-/me-/ps-/pe-), semantic HTML, accessible (aria labels, focus states, contrast ≥ 4.5:1), mobile-first, no external images (use inline SVG icons), no client-side JavaScript except where unavoidable.
4. **SEO**: the `metadata` export (title ≤60, description ≤155) and JSON-LD for Organization + WebSite (SearchAction to https://ghazihoushmand.ir/chat?q={search_term_string}) + FAQPage, embedded in the component.

Do not invent statistics, user counts or testimonials. Save the answer as `~/Downloads/gemini_out/landing_design.md` (copy the code block into `~/Downloads/gemini_out/LandingPage.tsx`).
