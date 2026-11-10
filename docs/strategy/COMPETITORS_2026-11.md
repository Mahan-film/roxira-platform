# Iranian SMB accounting market: what we take from it (2026-11)

Source: owner's Gemini Deep Research report, 2026-11-11 (Sepidar, Dasht, Rahkaran, Holoo, Mahak, Parsian, Tadbir, Parmis, Gheyas, Hesabfa, Abrestan, Chortke, Hoofer, Landa, Hasht). Prices are the report's figures; they were not checked against vendor sites.

## What customers rank highest

| Rank | Feature | Competitors with it (of 15) | Roxira today (origin/main, 2026-11-11) | Task |
|---|---|---|---|---|
| 1 | Moadian: all invoice patterns (main, amendment, cancellation, return, contracting statement, export/FX, Article 9), error diagnostics, 13-digit goods ID mapping | 15 | Types 1-3 live; other patterns partial | WAVE 5 T70, T71 |
| 2 | Sayad cheque lifecycle, ras-giri, discounting, maturity alerts | 15 (discounting 9) | Lifecycle live; no ras-giri or discounting | T72 |
| 3 | Fast invoicing, pre-invoice → invoice, form builder (A4, A5, thermal, barcode labels) | 13 | Invoicing live, A5 print template; no form builder | later |
| 4 | Dual units, serial/batch, item attributes | 12 | None | T73 |
| 5 | COGS and production BOM with waste % | 10 | FIFO + landed cost live; no BOM | later |
| 6 | Treasury, POS link, bank reconciliation, cash flow statement | 14 | Reconciliation, petty cash live; cash boxes in review (#716) | #716, #718 |
| 7 | 4-6 level chart with floating detail, account review drill-down | 11 | Live | done |
| 8 | Payroll with statutory tax and insurance files | 11 | Live (Tamin DBF, tax file); no attendance/leave/loans | T67 |
| 9 | Price tiers per customer group, rep commission, live price catalogue | 11 | None | T74 |
| 10 | WooCommerce sync, online payment link | 9 | None | later |
| 11 | Role permissions with login time windows, hidden purchase prices | 12 | Roles live; no time windows | T76 |
| 12 | Multi-currency and FX revaluation voucher | 8 | Currency module; no revaluation | T75 |
| 13 | Legacy migration (Sepidar/Holoo .bak, Excel) | 6 (true migration rare) | `.bak` pipeline, DuckDB, reconciliation certificate live; no Sepidar/Holoo mapping | T78, T79 |

## Where the market is weak (our openings)

- **No competitor ingests Sepidar/Holoo backups with open cheques and opening balances.** This is the biggest switching blocker. We already have the `.bak` pipeline and the reconciliation certificate, so T78/T79 is our strongest differentiator.
- **Moadian is free in Hesabfa and Holoo APEX**, a paid module in Sepidar (18.5-20.4M Toman) and Parsian (8-8.8M), and metered in Abrestan (2,990 Toman per invoice). Free direct sending is table stakes.
- **Holoo's inventory cost breaks on backdated invoices.** Our async FIFO re-costing (PRODUCT_DECISIONS) answers this; keep it tested.
- **Hesabfa's attendance fields do not compute pay.** T67 (attendance feeds payroll) is a real gap in the leader.
- **Customers fear the vendor holds their data hostage.** T77 (one-click full export, nightly export) answers it.

## Reference prices (report figures, 1405, one company, 2-3 users, per year)

| Product | Model | Approx. year-1 cost |
|---|---|---|
| Hesabfa | Cloud, unlimited users, priced by voucher volume | 5.7M-12.4M Toman (up to 24.9M unlimited) |
| Abrestan | Cloud, priced by users and item count, Moadian metered | 19.2M-23M Toman + Moadian |
| Gheyas cloud | Cloud | from 6.8M Toman |
| Parsian | Desktop | ~16.5-17.6M Toman incl. Moadian |
| Holoo APEX | Desktop | 14.4M-31.5M Toman |
| Sepidar | Desktop/cloud, modular | ~264M Toman + Moadian (1405 list) |

Pricing and packaging for Roxira are the owner's decision.

## Later (not in WAVE 5)

Form builder, production BOM, WooCommerce sync, bank SMS/POS auto-capture, Sayad colour inquiry (needs a licensed bank API), Telegram/Bale receipt bot on top of `modules/invoice_capture`, keyboard-first "accountant mode", Holoo migration, offline counter sales.
