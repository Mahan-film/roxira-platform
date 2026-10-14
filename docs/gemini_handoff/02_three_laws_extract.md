# Prompt 2 — Customs / Guild System / Direct Taxes laws → article JSONL

Attach the PDFs (or the .txt you copied from qavanin.ir) of: قانون امور گمرکی، قانون نظام صنفی کشور، قانون مالیات‌های مستقیم. One law per conversation is safer for the 158-page tax law.

---

You are a meticulous Persian legal transcriber. The attached document is the official consolidated text (with later amendments) of an Iranian law from qavanin.ir. Convert it to JSON Lines, ONE line per article (ماده). No markdown fences, no commentary.

Fields per line:
- `law_name`: the law title exactly as printed (e.g. "قانون مالیات‌های مستقیم")
- `approval_date`: original approval date "YYYY-MM-DD" (Solar Hijri, Latin digits)
- `section`: if the document contains two independent numbering sequences (an inserted bill/law that restarts at ماده 1), a short key for the sequence (e.g. "main", "lavayeh_1347"); otherwise "main"
- `chapter`: the nearest heading above the article (باب/فصل/بخش), as printed, or ""
- `article_no`: the article number with Latin digits; suffixes like "مکرر" become "12-mokarrar", "12 مکرر 1" becomes "12-mokarrar-1"
- `article_label`: the label as printed, e.g. "ماده ۱۲ مکرر"
- `amendment_notes`: the parenthetical status exactly as printed after the article number, e.g. "(اصلاحی ۳۰/۰۳/۱۴۰۳)", "(الحاقی ...)", "(منسوخه ...)", or ""
- `status`: "repealed" if the article is marked منسوخه/ملغی, otherwise "active"
- `text`: the full verbatim text of the article INCLUDING all its تبصره lines in order. Keep original wording, punctuation and digits. Do not summarise or modernise.
- `repealed_parts`: list of تبصره/بند inside this article marked repealed, as printed, or []
- `needs_review`: true if anything was unreadable or the article boundary was unclear
- `review_reasons`: short list

Rules:
1. Never invent or "complete" text. Unreadable → [ناخوانا] + needs_review true.
2. Keep articles in document order. Do not drop repealed articles; mark them.
3. Ignore page headers/footers, the qavanin.ir banner and page numbers.
4. At the very end output ONE extra line: {"_summary": true, "law_name": "...", "articles": N, "repealed": R, "needs_review": K}.

Save as `~/Downloads/gemini_out/laws_customs_guild_tax.jsonl` (append the three laws into the same file).
