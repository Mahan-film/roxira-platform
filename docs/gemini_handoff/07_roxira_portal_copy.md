# Prompt 7: honest copy and design for the Roxira portal (roxira.ir / roxira.net)

Attach: screenshots of the current pages roxira.ir/ , /services , /about , /contact (desktop and mobile).

---

Roxira is an Iranian company building business software: CRM, ERP, accounting, invoicing, inventory, HR,
Moadian (Iranian tax system) e-invoice integration, and an AI "software factory" that builds custom
business apps. Its first live product is «قاضی هوشمند» (ghazihoushmand.ir), a legal AI assistant.
The enterprise products are in a PRE-REGISTRATION phase: there are no public prices and customers fill in
a «درخواست همکاری / پیش‌ثبت‌نام» form.

Write new Persian copy (plus an English version for /en) for these pages: home, services, about, contact.

Hard rules (the company was audited; breaking these is a legal risk):
1. No prices, tiers or plans. The call to action is «پیش‌ثبت‌نام» or «درخواست دمو/همکاری».
2. No claim that is not true today: no customer counts, no "certified by", no "24/7", no uptime percentages,
   no security certifications, no "official Moadian partner", no fake testimonials or logos.
   For features still being built, use «در حال توسعه» or «به‌زودی».
3. About page: the founder is «ماهان محمدی». Write a short, modest bio placeholder ([[bio]]) that he fills in himself.
4. Keep these exactly as they are: the e-namad badge and the support phone line «پشتیبانی: 09129367796».
5. Mention قاضی هوشمند as a live product with a link to https://ghazihoushmand.ir.

Output:
- `roxira_copy_fa.md`: per page, a heading, sections, button labels, meta title (≤60) and meta description (≤155)
- `roxira_copy_en.md`: the same for /en
- `roxira_design_notes.md`: layout per page, colours and typography (RTL, Vazirmatn font), mobile notes.
  No code is needed; the developers build the components.

Give the three as downloadable files and save them to `~/Downloads/gemini_out/roxira/`.
