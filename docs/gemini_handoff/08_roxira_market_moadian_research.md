# Prompt 8: market research for Roxira ERP/CRM plus Moadian requirements

No attachments. Use Gemini's web search / Deep Research mode.

---

Research two things for an Iranian startup building cloud business software (CRM, ERP, accounting,
invoicing, inventory, HR, AI-built custom apps). Every claim needs a source link and an access date.
If you cannot find a source, write «منبع یافت نشد». Do not guess.

Part A: Iranian market (file `roxira_market.md`)
1. A table of the main Iranian competitors (for example همکاران سیستم, سپیدار, محک, رایورز, دیدگاه, پارس‌حساب,
   هلو, کلاود CRM providers, and others you find). For each: products, cloud or on-premise, public price
   (if published), target customer size, Moadian support, strengths, weaknesses, and Google/Bazaar reviews.
2. Gaps: what small and medium Iranian businesses complain about (forums, reviews, Telegram channels you can see).
3. Three positioning options for a new entrant, with the pros and cons of each.
   Do NOT recommend prices: pricing is the owner's decision. Only report what competitors publish.

Part B: Moadian / e-invoice technical requirements (file `moadian_requirements.md`)
1. The current official rules of سامانه مؤدیان (INTAMEDIA / tp.tax.gov.ir): who must issue electronic invoices,
   the phased deadlines, invoice types and patterns, the tax-memory id (شناسه یکتای حافظه مالیاتی),
   and the role of «شرکت معتمد» versus direct connection.
2. The technical API flow (token, invoice send, inquiry, status codes) as published in official docs or the
   official SDKs. Give the links to the official documents.
3. What a software vendor must do legally to send invoices on behalf of customers.
4. A checklist of fields an invoice must have.
Mark anything older than 12 months or not from an official source as «نیازمند بررسی».

Give the two files as downloads and save them to `~/Downloads/gemini_out/roxira/`.
