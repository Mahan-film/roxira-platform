# Smart Judge landing redesign (2026-10, v2: dark futuristic)

Route: `output_apps/enterprise_hub/frontend/src/app/home-ghazi/page.tsx` (ghazihoushmand.ir root is rewritten to it by middleware).

v1 (light, plain) was rejected by the owner: no real menu, no login entry, flat look. v2 brings back the look of the old static page (`output_apps/ecosystem_core/src/api/static/ghazi_landing.html`) inside Next.js, with the new brand logo.

| Decision | Reason |
|---|---|
| Dark theme: `#05080f` / `#0a0f1a`, subtle grid, blurred glow blobs, glass cards (`landing.css`, `gl-*` classes) | Owner liked the old dark 2026 look; palette is taken from the logo. Plain CSS file next to the page, no new packages |
| Gold (`#fbbf24 -> #f59e0b`) = primary CTA and headline highlight; cyan `#38bdf8` = kickers, links, focus rings, check icons | Same CTA colour as the old design; cyan comes from the left half of the logo and stays secondary |
| Header: mark + name, desktop nav (گفتگو، قوانین، آرا و بخشنامه‌ها، وحدت رویه، راهنماها، اشتراک‌ها، درباره) from `lg`, gold pill "ورود / ثبت‌نام (سریع)", hamburger below `lg` | The owner saw no menu and no sign-in. Nav list is one shared file (`components/landing/landing-nav.ts`) |
| Mobile menu = small client component (`landing-mobile-menu.tsx`): `aria-expanded`/`aria-controls`, Esc closes and returns focus, first link focused on open, body scroll locked | Accessible full-screen menu. Header blur is on a `::before` because `backdrop-filter` on the header would trap the fixed overlay |
| Login pill goes to `/chat?login=1`; `chat-shell.tsx` opens the existing `openLogin({serviceDomain:"GHAZI"})` dialog (same as the chat header) and strips the param | No second auth system; login lives in the chat app's `AuthProvider` |
| Hero question box (`hero-ask.tsx`): textarea + attach + voice + big gold CTA "شروع بررسی هوشمند پرونده"; submit goes to `/chat?q=<text>`, `chat-shell.tsx` sends it once and removes the param; attach/voice link to `/chat` | The old page's main hook: ask right in the hero. Attachments and recording already exist in the chat, so the landing does not duplicate them |
| Headline kept: «پاسخ حقوقی مطمئن و مستند به قانون، در چند ثانیه» (gold gradient on the second half) | Existing approved copy |
| Stats, FAQ + FAQ JSON-LD, disclaimer, pricing teaser (names from `LEVEL_COPY`, no prices) unchanged in substance | Only true build-time numbers; prices stay live on `/plans` |
| Motion: fade-up on hero, slow float on the emblem, ping dot, card hover lift; all disabled under `prefers-reduced-motion` | Subtle, CSS only, no CWV cost |
| Text contrast: body `slate-300` / small text `slate-400` or lighter on near-black (above 7:1); amber-300 on dark | WCAG AA |
| Mobile first (360-430px): emblem above the text at 300px, single column, `overflow-x: clip` on the root | No horizontal scroll |

## Logo decision

- The owner's emblem (glowing circuit, scales + gavel, cyan to gold, on carbon) is used as a **photo** only where there is room: hero (`public/brand/ghazi-emblem-960.webp`, 960x616, ~86 KB, `next/image` with explicit size and `priority`, soft radial mask so its carbon background melts into the page) and social sharing (`og:image` = `public/brand/ghazi-emblem.webp`, 1668x1070 original).
- For small sizes (header 36px, footer 28px, app icons, favicon) a detailed glow image turns into mud and costs bytes. So a clean **inline SVG mark** is drawn from the same idea: round ring, scales, diagonal gavel, thin strokes, gradient cyan to gold (`components/brand/GhaziMark.tsx`). The same mark is in `public/icons/ghazi-192.svg`, `ghazi-512.svg`, `ghazi-maskable.svg` on a `#05080f` background (maskable has extra safe-zone padding).
- Rule: photo for >= 300px / sharing, SVG mark for everything smaller. Do not downscale the photo into a header.

Not changed: backend APIs, routes, Umami wiring. Subscription modal change from v1 (inline checkout errors) stays.
