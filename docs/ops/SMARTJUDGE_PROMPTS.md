# Smart Judge prompt library (کتابخانهٔ پرامپت)

Module: `output_apps/generated_modules/smartjudge/prompt_library.py` (pure, no I/O).
Smart Judge stays a NON-BINDING AI assistant. Banners, disclaimers and VIP gating are untouched.

## نحوهٔ کار (How it works)

1. `detect_domains(text)` scores domains with deterministic Persian keyword rules
   (`DOMAIN_KEYWORDS`): civil, criminal, family, commercial, labor, administrative,
   guild_violations, computer_guild, disciplinary_bar, competence_question.
   Text is normalised like `court_catalog` (Latin digits, ی/ک, ZWNJ -> space).
2. `build_system_prompt(domains, grounded, user_text)` composes the Persian system prompt:
   role (non-binding), grounding rules, Latin digits rule, a template, court guidance, length cap.
3. `expand_competence_queries(text)` returns at most 3 de-duplicated extra retrieval queries
   (from `COMPETENCE_QUERY_TEMPLATES`) only when a competence question is detected.

## بخش‌ها (Sections)

- Grounded: cite only articles in the retrieved block; never invent numbers; unknown ->
  `ماده [تأییدنشده]`. Ungrounded: no article/ruling numbers at all (existing general-knowledge
  notice path still wraps the answer).
- Multi-domain (2+ case domains): one short section per domain with sub-headings
  وقایع مؤثر، صلاحیت/مرجع صالح، مستند قانونی (فقط از پایگاه)، مهلت‌ها، ادله، ریسک‌ها، گام بعدی;
  then «ارتباط میان دعاوی» and a short «اطلاعات ناقص» list.
- Competence question: 1) قاعدهٔ حاکم (from retrieved text only), 2) انطباق با وقایع,
  3) استثناها و مواردی که باید راستی‌آزمایی شود.
- Always: max about 450 words; ask up to 3 clarifying questions when facts are insufficient.
- «مراجع احتمالی» from `court_catalog.suggest_courts` is appended as guidance only.

## فعال‌سازی (Enabling)

Set `SMARTJUDGE_PROMPT_LIBRARY=1` (also `true`/`yes`/`on`) in the API environment.
Off (default): `/consult` behaves exactly as before. Voice mode (`is_voice_mode`) keeps the short
voice prompt even when enabled. When on and a competence question is detected, `/consult` runs up
to 3 extra `aquery_knowledge_graph` calls, merges new real rows (by title) and drops placeholder
FALLBACK rows once real rows exist. Only `/consult` (and its `/chat` alias) is wired.

## تنظیم کلیدواژه‌ها (Tuning keywords)

Edit `DOMAIN_KEYWORDS` and `COMPETENCE_QUERY_TEMPLATES` in `prompt_library.py`. Score = number of
distinct keywords found. Add a test in `smartjudge/tests/test_prompt_library.py` for each change.

## محدودیت‌ها (Known limits)

- Keyword rules and checklists are NOT legally reviewed.
- The corpus may lack the 1402 peace-court law and other competence statutes
  (see `docs/research/LEGAL_CORPUS_GAP_AUDIT_2026-10.md`); the expansion queries then return
  nothing and the never-empty general-knowledge path applies. Articles are never invented.
- Short generic keywords (e.g. «سند», «جرم») can over-trigger domains; multi-domain prompts need
  2+ domains, so a stray hit may add an unnecessary section.
- Prompt-level structure is not enforced on model output; free models may ignore it.
- 16 s router timeout and 1500 max tokens still apply; long structured answers may truncate.
