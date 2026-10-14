# Prompt 1 — CBI circulars → clean JSONL (attach the 29 numeric PDFs)

Copy everything below the line into Gemini, then attach the PDFs.

---

You are a meticulous Persian legal-document transcriber. I attached official circulars of the Central Bank of Iran (بانک مرکزی جمهوری اسلامی ایران) as PDFs. Their embedded text layer is corrupted, so read the PAGE IMAGES, not the text layer.

For EACH PDF produce JSON Lines (one JSON object per line, UTF-8, no markdown fences, no commentary) with exactly these fields:

- `doc_id`: "cbi_" + the circular number with "/" replaced by "_" (example: number 05/101819 → "cbi_05_101819")
- `doc_type`: "circular"
- `issuer`: the issuing body exactly as printed (normally "بانک مرکزی جمهوری اسلامی ایران")
- `number`: the circular number exactly as printed (Latin digits, keep "/")
- `date`: the circular date in Solar Hijri, format "YYYY-MM-DD" with Latin digits
- `subject`: the subject line (موضوع) exactly as printed
- `addressee`: who it is addressed to (e.g. "مدیران عامل محترم بانک‌ها..."), or "" if absent
- `chunk_index`, `chunk_count`: split the body into chunks of about 1200 Persian characters, never cutting inside a numbered clause (بند/ماده/تبصره); index from 0
- `text`: the verbatim body text of that chunk. Keep the original wording, numbering and punctuation. Use Persian digits as printed. Do NOT summarise, translate, fix grammar or fill gaps.
- `references`: list of other circulars/laws explicitly cited in this chunk, as printed (e.g. ["بخشنامه شماره 999/289617 مورخ 1399/9/11"])
- `source_file`: the PDF file name
- `needs_review`: true if ANY word in this chunk was unreadable or uncertain, else false
- `review_reasons`: short list of what was uncertain (e.g. ["stamp covers line 3", "table page 4 unclear"])

Rules:
1. Never invent text. If a word is unreadable, write [ناخوانا] in its place and set needs_review true.
2. Ignore letterheads, page numbers, stamps and signatures, except: put the signer's name/title in a final chunk field `signed_by` only on the last chunk (other chunks: "").
3. Tables: write each row as one line "ستون۱ | ستون۲ | ..." inside the text.
4. If two PDFs are the same circular, output it once and add `duplicate_files` with both names.
5. If a PDF is not a CBI circular, output one line {"source_file": "...", "skip": true, "reason": "..."}.

Output only the JSONL. When done, I will save it as `~/Downloads/gemini_out/cbi_circulars.jsonl`.
