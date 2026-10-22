# data_import test fixtures

- `erp_multicurrency_small.sqlite` (240 KB): consistent subset of the owner's challenge database
  (Gemini-generated, 2026-10-22; full set = 7 tables / 86,031 rows / 15 MB). Tables keep their original
  Finglish names and columns: `tbl_Accounts_Coding` (31 accounts, currencies ریال / تومان / USD / EUR / TRY /
  AED / OMR / CNY, plus traps `MULTI` and the Persian name «درهم» for AED), `tbl_Moshtarian_Peymankaran`
  (parties, key `TafziliCode`), `tbl_Kala_Anbar` (items; `GheymatForoosh_Toman` = Rial / 10),
  `tbl_Factorha_Kharid_Foroosh` (invoices, `NerkhTasir_BeRial` = 10 for toman), `tbl_Sanad_Hesabdari_Riz`
  (journal lines, vouchers 1..100, every voucher balanced; `Bedehkar_Rial + Bestankar_Rial = MablaghArzi *
  NerkhTasir`), `tbl_CRM_Leads_Activities`, `tbl_Havalejat_Arzi_Exchange` (FX deals). Dates are Jalali
  `1403/MM/DD`. References use `TafziliCode` / `PartyID` without declared foreign keys.
- `erp_corrupted_truncated.sqlite`: first 12,000 bytes of the same file; must be rejected with a clear error
  (the owner's full file actually arrived malformed).
- A `.sql` dump fixture is generated inside the tests from the sqlite fixture (repo rule: no `*.sql` files).
