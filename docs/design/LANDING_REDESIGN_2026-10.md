# Smart Judge landing redesign (2026-10)

Route: `output_apps/enterprise_hub/frontend/src/app/home-ghazi/page.tsx` (ghazihoushmand.ir root is rewritten to it by middleware).

History: the file has only two commits (#623 creation, #663 nav link), so no earlier "nicer" version exists in git for this route; the redesign is built fresh on the existing content, copy and routes.

| Decision | Reason |
|---|---|
| Header: 56px on mobile, logo + short name "قاضی هوشمند", small "شروع" CTA (full "شروع رایگان گفتگو" from `sm`), hamburger `<details>` menu below `md` | The old 40px logo + long title + 20px-padded button overflowed 390px; `<details>` needs no JS and no new library |
| "قوانین ۱۴۰۵" pill moved from header into the trust chips | It wrapped under the title on mobile; it is a trust fact, not branding |
| Hero: eyebrow chip, H1 (text unchanged), one-line sub copy, ONE primary CTA "سؤال حقوقی‌ات را بپرس", ONE secondary "جستجوی متن قوانین" | Clear hierarchy; long paragraph removed (was text-heavy). Buttons full width up to 384px on mobile (48px touch target) |
| Trust signals = rounded chips (flex-wrap) with check icon, slate-700 on white | Replaces grey 12px text row; contrast above AA |
| Soft blue gradient behind hero only, no animation (pulse dot removed, no wavy underline) | 2026 look, zero CWV cost, no motion |
| Stats card: article count + law count from `public/coverage_manifest.json` (`loadCoverageTotals`, same source as /coverage) and guide count from `GUIDE_SLUGS.length` | Only true, build-time numbers; nothing invented |
| 3 steps as a compact list (row on mobile, columns from `md`), 6 features as short cards | Less vertical space, removes the big empty grey gap; text shortened |
| Pricing teaser: level names from `LEVEL_COPY` + link to `/plans`, no prices | Prices are served live from the server matrix; hardcoding would go stale |
| FAQ keeps 4 questions and the FAQ JSON-LD unchanged; disclaimer kept as one amber card | SEO/legal content preserved |
| Colours: slate-600+ body on white, amber-700 (not 600) for small amber text, `dark:` variants kept everywhere | WCAG AA; dark mode still works |
| Spacing scale: sections `py-14` / `sm:py-20`, cards `p-5`, gaps 3/4 | Consistent 4px-based rhythm |
| Font: existing Vazirmatn (`font-sans` from layout) | No new font load |
| Focus rings on all links/summary; decorative SVGs `aria-hidden`; real `<main>`, `<ol>`, `<dl>` | Accessibility |
| No layout shift: no images, no client JS, server component | CWV |

Subscription modal (`src/components/judge/subscription/subscription-modal.tsx`): the checkout error/notice now renders inside the card of the pressed plan, directly under its button, in an always-mounted `role="status" aria-live="polite"` region. The pressed button shows a spinner and "در حال صدور فاکتور..."; all plan buttons are disabled while one checkout is pending (prevents double invoices). `track("checkout_started")` and the redirect guard are unchanged.

Not changed: backend APIs, routes, `track(...)`/Umami wiring (the landing page never had inline track calls; Umami is loaded in `layout.tsx`).
