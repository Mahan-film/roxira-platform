# Tasks

- Scaffold static Next.js app with RTL Tailwind and Vazirmatn owned: package.json, next.config.mjs, tsconfig.json, tailwind.config.ts, postcss.config.mjs, app/layout.tsx, app/page.tsx, app/globals.css, components/theme-provider.tsx, components/theme-toggle.tsx, lib/utils.ts, public/fonts/
- Define FAQ content schema and Markdown loader owned: lib/faq/types.ts, lib/faq/load.ts, content/faq/
- Author the 10 Persian legal FAQ Markdown entries owned: content/faq/
- Build FAQ list and detail components with disclaimer owned: components/faq/faq-card.tsx, components/faq/faq-detail.tsx, components/faq/disclaimer.tsx, app/page.tsx
- Add in-page client-side search filter owned: components/faq/faq-search.tsx, lib/faq/normalize.ts, app/page.tsx
- Add per-question static routes and metadata owned: app/faq/[id]/page.tsx, components/faq/faq-card.tsx
- Add Playwright tests for search and Persian rendering owned: playwright.config.ts, tests/e2e/faq.spec.ts, package.json
- Add GitHub Pages static deploy workflow owned: .github/workflows/deploy.yml, next.config.mjs, README.md
