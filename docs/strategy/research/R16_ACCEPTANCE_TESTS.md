# R16 core acceptance tests (T177)

Source: owner's deep research R16 (2026-11-17), stage 1 tests with the stage 2 fixes applied. Amounts are exact; every test is deterministic.

## Test 1 — Multi-entity, intercompany elimination, minority interest
Data: parent P (reporting EUR) owns 80% of subsidiary S (functional EUR). S: external sales 120,000.00, external expenses 60,000.00. P bills S a management fee 10,000.00 (P: IC revenue / IC receivable 10,000.00; S: IC expense / IC payable 10,000.00). P has 90,000.00 standalone external profit (100,000.00 incl. the fee). P's investment in S = S's share capital at acquisition (choose: investment 40,000.00 vs S equity 50,000.00, 80% = 40,000.00, NCI share of equity 10,000.00).
Steps: post the IC invoice in P; the mirror bill appears in S. Run consolidation into group C.
Pass: eliminations Dr IC revenue 10,000 / Cr IC expense 10,000 and Dr IC payable 10,000 / Cr IC receivable 10,000; investment eliminated against S equity (Dr S equity 50,000 / Cr investment 40,000 / Cr NCI equity 10,000); consolidated net income before NCI 150,000.00; NCI 10,000.00 (20% of 50,000); controlling net income 140,000.00; consolidated balance sheet balances.

## Test 2 — Three currencies, revaluation, rounding, cross-currency settlement
Data: entity DE-OPS book EUR, reporting USD, rate precision 6 decimals. 2026-10-15: invoice INV-101 GBP 1,000.00 (1 GBP = 1.182500 EUR; 1 EUR = 1.085000 USD). Also a 3-line invoice of GBP 10.00 per line at 1 GBP = 1.182550 EUR (11.8255 -> 11.83 EUR per line; header 30.00 x 1.182550 = 35.4765 -> 35.48 EUR). Closing rate 2026-10-31: 1 GBP = 1.201255 EUR. 2026-11-05: settlement USD 1,300.00 into a USD bank at 1 USD = 0.915000 EUR, contractual 1 GBP = 1.300000 USD.
Pass: INV-101 posts EUR 1,182.50 book / USD 1,283.01 reporting; the 3-line invoice posts a 0.01 EUR rounding residual so the entry balances; 2026-10-31 unrealised FX gain EUR 18.76 (1,201.26 - 1,182.50), reversed 2026-11-01; settlement without a clearing account: Dr USD bank EUR 1,189.50, Cr AR EUR 1,182.50, realised FX gain EUR 7.00; GBP receivable closes to 0.00; reporting-currency settlement difference USD 16.99 recorded.

## Test 3 — Period close and locks
Data: periods 2026-10, 2026-11 open, plus an adjustment period; a second entity on the Jalali calendar (1405-07..1405-12). Unposted draft bill DRAFT-9 dated 2026-10-20.
Steps: soft-lock 2026-10 with an exception for role chief accountant; AP clerk posts DRAFT-9 -> rejected. Try hard-close with DRAFT-9 unposted -> blocked. Void DRAFT-9, hard-close, then admin tries to unlock or post 2026-10-15.
Pass: clerk gets 422 PERIOD_LOCKED, chief accountant can post adjustments; hard close blocked naming DRAFT-9; after hard close no one can unlock or post into 2026-10 (corrections go to 2026-11 or the adjustment period); Jalali entity cut-offs follow Jalali month ends.

## Test 4 — Audit trail and immutability
Data: posted journal J-42 (Dr rent 2,500.00 / Cr AP 2,500.00) with GL audit number 42 and hash H42 = SHA256(H41 || canonical(entity_id, gl_audit_number, posted_at_utc, lines with three amounts)).
Steps: try to change amount or number via API and as a privileged DB role; reverse J-42 with J-43; change a VAT code description; read the change log in the same session; call verify-chain.
Pass: mutations fail (403/409 and DB trigger); J-43 gets number 43 and H43 = SHA256(H42 || canonical(J-43)); change log shows user, time, old and new value immediately; verify-chain returns VALID, 0 gaps, 43/43.

## Test 5 — Dimensions
Data: dimensions CostCenter, Project, ProductLine, Region, Grant, plus e-invoicing enabled. Rule: CostCenter required on P&L accounts; Project required when CostCenter = CC-RND. Bill BILL-55 EUR 1,000.00 split 600.00 CC-RND/PRJ-ALPHA and 400.00 CC-SALES.
Steps: enable e-invoicing; post a CC-RND line without Project; post BILL-55; rename CC-SALES to CC-EMEA-SALES effective 2026-11-01; balance sheet by CostCenter at 2026-10-31 and 2026-11-30.
Pass: e-invoicing uses no dimension slot; missing Project -> 422 DIMENSION_RULE_VIOLATION; 2026-10-31 report shows CC-SALES 400.00, 2026-11-30 shows CC-EMEA-SALES; each dimension's balance sheet balances.

## Test 6 — Budgets and encumbrance
Data: budget account 6400 + CC-MKT, October EUR 5,000.00 (2 decimals); warn at 80%, block at 100%.
Steps: PO-88 EUR 4,200.00; PO-89 EUR 1,000.00; revise budget to 5,500.00; resubmit PO-89.
Pass: PO-88 passes with an 84% warning (800.00 left); PO-89 (104%) blocked; after revision PO-89 passes leaving 300.00.

## Test 7 — Multi-book fixed assets
Data: machine bought 2026-01-01 USD 26,400.00 at 1 USD = 0.909091 EUR -> EUR 24,000.00, CC-PLANT-A. Book 1 IFRS straight-line 48 months = 500.00/month; Book 2 tax 30% declining year 1 = 600.00/month.
Steps: depreciate Jan–Mar; transfer to CC-PLANT-B on 2026-04-01; depreciate Apr–Jun; sell 2026-07-01 for EUR 22,000.00 net + 19% VAT (EUR 4,180.00).
Pass: at 03-31 book 1 accumulated 1,500.00 (NBV 22,500.00), book 2 1,800.00 (NBV 22,200.00); transfer reclassifies cost 24,000 and accumulated 1,500 between cost centres without reversing Q1; Q2 depreciation on CC-PLANT-B; sale: output VAT 4,180.00, book 1 gain 1,000.00 (22,000 - 21,000), book 2 gain 1,600.00 (22,000 - 20,400).

## Test 8 — Inventory valuation
Data: SKU-FIFO, SKU-AVCO, SKU-STD (standard 11.00). Each: day 1 receive 10 @ 10.00, day 2 receive 10 @ 12.00, day 3 deliver 12.
Pass: FIFO COGS 124.00, ending 96.00; AVCO COGS 132.00, ending 88.00; STD PPV +10.00 day 1, -10.00 day 2, COGS 132.00, ending 88.00; GL inventory 272.00 equals subledger; manual journal to the inventory control account and issuing 20 units with negative stock disabled are both rejected.

## Test 9 — Bank import and reconciliation
Data: open INV-101 1,190.00, INV-102 600.00, INV-103 400.00. Statement (CAMT.053): TX-1 +1,190.00 ref INV-101; TX-2 +970.00 payout for INV-102 + INV-103 less 30.00 fee.
Steps: import and auto-match; import the same file again 24 h later.
Pass: TX-1 matches INV-101; TX-2 in one reconciliation: Dr bank 970.00, Dr bank fees 30.00 / Cr AR INV-102 600.00, Cr AR INV-103 400.00, with a match explanation; the replay creates no duplicate lines or postings.

## Test 10 — Tax engine
Data: standard VAT 19% until 2026-06-30, 20% from 2026-07-01 (synthetic rates).
A: credit note 2026-07-10 for an invoice dated 2026-06-20, net 1,000.00. B: DE company buys a 1,000.00 service from an IE supplier (reverse charge). C: non-resident contractor bill 1,000.00, no local VAT charged (buyer self-accounts reverse-charge VAT 15%), 5% withholding at payment.
Pass: A uses 19% (190.00), a new 2026-07-10 invoice uses 20%; B posts Dr expense 1,000 / Cr AP 1,000 and Dr input VAT 190 / Cr output RC VAT 190 (net 0), mapped to reverse-charge return boxes; C at bill: Dr expense 1,000 / Cr AP 1,000 plus self-assessed VAT 150 in and out; at payment: Dr AP 1,000 / Cr bank 950, Cr WHT payable 50, certificate WHT-2026-0001.

## Test 11 — E-invoice adapters
Data: adapter KSA (ICV 103, PIH = hash(103)); adapter UAE (Peppol ASP). KSA-B2B-104 SAR 1,000 + 150 VAT; KSA-B2C-105 SAR 115.00; UAE-FTZ-201 AED 1,000 + 50 VAT with free-zone and continuous-supply flags.
Pass: rejected B2B stays CLEARANCE_REJECTED, buyer delivery blocked, its UUID/ICV retired; resubmission gets ICV 105 chained to the last valid hash; B2C issued offline with a QR and reported within 24 h when back online; UAE XML carries the flags without using dimensions.

## Test 12 — Accountant access
Data: firm user with role partner advisor on three tenants: view GL, request documents, post adjustment-period journals; no bank-detail edits, no payments.
Pass: adjustment journal tagged PARTNER_ADJUSTMENT with the firm user id; IBAN edit 403; revoking the user ends sessions on all three tenants within 60 s and writes a security audit entry.

## Test 13 — API idempotency and webhooks
Pass: POST /journals with Idempotency-Key k-999 and EUR 500 repeated after 30 min returns the original 201 body, no duplicate; same key with EUR 600 returns 409 IDEMPOTENCY_CONFLICT; a burst gets 429 with Retry-After; webhooks for invoice.posted and asset.depreciated retry after 503s and succeed on the third attempt with a valid signature.

## Test 14 — Auditor export
Data: 50,000 posted lines in Q1 2026, audit numbers 1..50,000.
Pass: GDPdU, DATEV and SAF-T exports run as background jobs; outputs validate; summed debits and credits equal the trial balance; no gaps in audit numbers.

## Test 15 — AI controls
Data: vendor with VAT id, open PO-200 EUR 2,400.00, emailed PDF invoice for annual hosting; an unusual manual journal (Dr cash 50,000 / Cr marketing 50,000) at 02:14.
Pass: the AI agent matches vendor and PO, proposes a 12-month prepaid deferral, saves an unposted draft attributed to the AI identity with citations; the unusual journal raises an outlier alert that must be acknowledged before period close.
