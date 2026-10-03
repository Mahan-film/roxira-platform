---
name: citation-check-ir
description: Verify that every statute article cited in an Iranian legal text exists in the retrieved corpus, using the /citations/verify endpoint. Use before presenting any answer or draft that cites articles (ماده). Never invent article numbers.
---

# citation-check-ir

## When to use
Any answer, draft ruling, or contract review that cites an Iranian law article.

## Instructions
1. Extract every citation (law name + article number, e.g. "ماده ۱۰ قانون مدنی") from the text.
2. Send all citations to the `/citations/verify` endpoint of the API. Do not decide from memory whether an article exists.
3. For each citation, record the result: VERIFIED (found in the retrieved corpus) or UNVERIFIED.
4. Never invent, guess, or "correct" an article number. If a citation is UNVERIFIED, remove it or flag it; do not replace it with a similar number.
5. Never quote article text that did not come from the retrieved corpus.
6. If the endpoint is unavailable, report that verification was not possible and mark all citations UNVERIFIED.

## Output (Persian, user-facing)
A table: ارجاع | وضعیت (تأیید شد / تأیید نشد) | توضیح.
End with one line: «ارجاعات تأییدنشده نباید در متن نهایی استفاده شوند.»
