# qavanin.ir print versions vs. staged corpus (2026-10-13)

Parser: `scripts/legal/parse_qavanin_print.py`. Output: `data/legal/staged/qavanin_2026-10-13.jsonl`
(plus `.repealed.jsonl`, `_report.json`). Rows are `staging_status=proposed`, `source=qavanin`,
`source_tier=official`.

## Inputs
| Law | PDF pages | Result |
|---|---|---|
| E-Commerce Law (1382) | 16 | 81 articles (1-81, no gaps, no duplicates), 11 carry amendment notes |
| Direct Taxes Law | 158 | **0 articles: the PDF has no body text.** Safari printed only the page header/footer and empty ornaments (rasterised at 50 dpi: blank pages). It must be re-saved (print the page after it fully loads, or use qavanin's own PDF/Word export). |

## E-Commerce: qavanin vs. staged nezamat (`nezamat_ecommerce_1382`, 81 rows)
No ekhtebar rows for this law exist in `data/legal/` (the staged ekhtebar file covers other laws); nezamat is the only
copy, so the comparison is against it. Wording similarity (spelling/spacing/notes neutralised): 66 of 81 articles >= 0.97,
15 differ.

- **Art. 75**: qavanin = amended 1403/03/30, fine "825.000.000 ریال", prison 6 months to 2.5 years. Ours (nezamat) body
  still reads "پنجاه میلیون ریال" with the 1399 (250M) and 1403 (825M) increases only as bracket notes, so the body text is
  stale and contradicts its own note.
- **Penalty articles 68-70, 73-76** (all amended 1403/03/30): nezamat bodies hold the original 1382 amounts
  (e.g. art. 76: 20M-100M rial vs. qavanin 330M-825M; art. 69: 10M-50M vs. 165M-660M). Qavanin states the current amounts.
- **Arts. 32, 48, 79, 80**: qavanin has the 1390/04/08 amendment (وزارت صنعت، معدن و تجارت); nezamat still says
  وزارت بازرگانی. Art. 79 and 80 also differ in wording; nezamat art. 79 has an extra «فقدان حق انصراف» sentence absent in qavanin.
- **Arts. 67, 68**: qavanin marks the تبصره as repealed (منسوخه 1399/02/23); nezamat art. 67 still carries it as active.
  The parser keeps these in `repealed_parts`, out of the active text.
- Minor: arts. 5, 30, 57 differ only by Latin glosses/extra words.

## Direct Taxes
Cannot be compared: no qavanin text was extracted. For reference, the staged nezamat set
(`nezamat_direct_tax_1366`, 256 active + 36 repealed) is not the stale 1394 text: 20 articles have `amended_on` 1404,
plus 1399-1402 entries. Whether qavanin has 1403/1404 amendments that nezamat lacks is **unknown** until a readable PDF exists.

## Extraction caveats (from the PDF text layer)
- pdftotext reverses parenthesised reference lists; the parser restores `(39)، (50)... و (55)` heuristically and flags those rows
  `needs_review` with reason `pdf_bidi_reference_repair` (17 rows). A human spot-check of these is advisable.
- Art. 70 source text contains "330.000.000 000" (likely a qavanin glitch); flagged `suspicious_number_in_source`.
- A few cosmetic leftovers remain (e.g. stray ")ارسال شده(" parentheses, a detached "ی" in "«داده پیام» ی").
- Duplicate article numbers: rows carry a `section` key (null here); use `--section REGEX=KEY` for the 1311/1347 commerce law.
