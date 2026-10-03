---
name: ruling-draft-review-ir
description: Review a non-binding AI-generated draft ruling (civil or criminal) for Iranian courts. Checks the draft banner, citation validity, absence of punishment numbers in criminal drafts, and marks INSUFFICIENT_BASIS when evidence is thin.
---

# ruling-draft-review-ir

## When to use
Reviewing an AI-generated draft ruling (پیش‌نویس رأی). The draft is non-binding and assists a human judge only.

## Checklist
1. Banner: the draft must start with a visible banner stating it is an AI-generated, non-binding draft that does not replace the judge's decision. If missing, fail the review.
2. Citations: run the `citation-check-ir` skill. Every cited article must be VERIFIED via `/citations/verify`. Any UNVERIFIED citation is a blocking issue.
3. Criminal drafts: the draft must contain no punishment numbers (no prison term, fine amount, lashes, or similar quantities). Qualitative reference to the legal basis is allowed; the quantum is for the judge. Flag any such number as blocking.
4. Evidence: each finding of fact must point to a document or statement in the case file. If the evidence is thin, contradictory, or missing for a necessary element, the draft must say `INSUFFICIENT_BASIS` for that point instead of concluding. If it concludes anyway, flag it.
5. Structure: parties, claims, facts, reasoning, legal basis, and conclusion are all present and consistent.
6. Do not add facts, articles, or precedents that are not in the case file or retrieved corpus.

## Output (Persian, user-facing)
- نتیجه کلی: قابل قبول / نیازمند اصلاح / مبنای ناکافی (INSUFFICIENT_BASIS)
- فهرست موارد بررسی با وضعیت هر مورد و توضیح کوتاه.
- یادآوری پایانی: «این پیش‌نویس الزام‌آور نیست و تصمیم نهایی با قاضی است.»
