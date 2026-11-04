# Screenshots for the 2026-11 design audit

Not captured yet: the tour helper signs up a new tenant on production, which the audit agent may not do.

Run from a machine whose owner approves a throwaway QA tenant (`@example.invalid`, synthetic data only):

```bash
cd e2e && PROD_TOUR=1 npx playwright test -c playwright.tour.config.ts
```

Then take, for each route in `docs/design/DESIGN_AUDIT_2026-11.md`, a desktop (1440x900) and a 375 px shot named
`<route>-desktop.png` / `<route>-375.png` into this folder, and re-check the findings tagged **[data]**.
