# Smart Judge behavior / رفتار قاضی هوشمند

Smart Judge is a NON-BINDING AI legal assistant, never a judge.
قاضی هوشمند دستیار حقوقی غیرالزام‌آور است، نه قاضی.

## 1. Never-empty answers / پاسخ‌های هرگز خالی

Before: `POST /chat` (`/consult`) called the model with no legal context when
retrieval returned nothing; worse, `aquery_knowledge_graph` then substituted a fixed
placeholder row (`match_level=FALLBACK`, article 1082 of the Civil Code) that was fed
to the model as if it were a corpus hit. No notice, no citation guard on chat.

Now (`chat_safety.py`): rows with `FALLBACK` do not count as grounding. When there is
no real retrieval hit the model still answers from general knowledge, and the reply is
wrapped as: fixed Persian notice (general knowledge, outside the verified corpus) +
answer + legal disclaimer. Article numbers not confirmed by the citation guard
(`_guard_citations`) are replaced by `ماده [تأییدنشده]`. Out-of-scope refusal and the
identity/greeting fast paths are unchanged.

## 2. Latin digits / ارقام لاتین

All chat replies, defense drafts and ruling drafts are converted to 0-9 by
`to_latin_digits` (Persian and Arabic-Indic digits). JSON keys, ids, hashes, article
identifiers and Persian words are untouched. Prompts also say "use Latin digits".

## 3. Ruling draft court types / انواع دادگاه در پیش‌نویس رأی

`court_type`: `civil`, `criminal`, `family` (دادگاه خانواده), `commercial` (دادگاه
تجاری), `labor` (دادگاه کار), `administrative` (دیوان عدالت اداری). Each new type has a
Persian display name, party labels and a structure checklist in
`ruling_draft.COURT_TYPES`. Banner, status, INSUFFICIENT_BASIS and citation checks are
shared. The punishment ban stays criminal-only. For the four new types the operative
part is always prefixed `پیشنهاد (غیرقطعی)`; no final award or custody decision.
