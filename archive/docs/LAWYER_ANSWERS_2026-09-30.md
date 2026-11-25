# Lawyer answers, round 1 (2026-09-30) and what they change

Source: the owner's lawyer, relayed by the owner in chat. These are binding product rules for the legal corpus until a
later answer replaces them. Questions: `docs/LAWYER_QUESTIONS_FA.md`. Round 2: `docs/LAWYER_QUESTIONS_ROUND2_FA.md`.

## Answers (original wording, Persian)

1. موارد نسخ‌شده باید حذف شود.
2. همه‌ی قوانین از روزنامه رسمی و مرکز پژوهش‌ها ذکر شود.
3. آخرین قانون آیین دادرسی کیفری (سال ۹۲) ملاک است.
4. قانون روابط موجر و مستأجر: همه باید باشد.
5. قانون محکومیت‌های مالی سال ۹۴ ملاک است.
6. قانون تأمین اجتماعی با آیین‌نامه‌ها ملاک است.
7. دادگاه صلح تا ۱۰۰ میلیون تومان.
8. نظر مشورتی ملاک نیست.
9. ولی آرای وحدت رویه ملاک است.
10. جرایم در صلاحیت دادگاه کیفری ۱ و ۲ در آیین دادرسی کیفری تعریف شده است.

## Rules derived (hub)

| # | Rule | Effect on the system |
| --- | --- | --- |
| R-A | Repealed articles are removed, not kept as inactive | Ingest drops `is_active=false` rows; the 18 inactive rows in `iran_laws_v2` are deleted at the next approved prod ingest |
| R-B | Only official sources: Official Gazette (rrk.ir) and the Parliament Research Center (rc.majlis.ir) | `source_tier` must be `official` for anything served. ekhtebar.ir is a locator only. The three laws now marked owner-supplied/ekhtebar (آیین دادرسی مدنی, شوراهای حل اختلاف ۱۴۰۲, صدور چک) must be re-fetched from rc.majlis.ir |
| R-C | Criminal procedure code 1392 is the reference | Already in corpus; confirm its consolidated text against rc.majlis.ir |
| R-D | All rent laws are needed | Add 1362 and 1376 next to 1356 (official ids still to find) |
| R-E | Financial-sentences law 1394 is the reference | Staged from rc.majlis.ir (29 articles) |
| R-F | Social security law with its regulations | Law plus regulations enter Phase 1 scope (official ids still to find) |
| R-G | Peace court handles claims up to 100 million toman | Goes into a data file of jurisdiction rules with its legal basis; never hard-coded in prompts. Legal basis (article) still to be cited: round 2 |
| R-H | Advisory opinions are not authoritative | Removed from the Phase 4 ingest list; if ever shown, labelled non-binding and never cited as law |
| R-I | Unification rulings (وحدت رویه) are authoritative | First item of Phase 4 |
| R-J | Criminal court 1 / 2 jurisdiction comes from the criminal procedure code | Jurisdiction table cites those articles instead of restating them |

## Still open from round 1

Question 1 (is «لایحه اصلاحی قانون تجارت» in force), 5 (courts law 1373 after 1392), 7 (which civil-execution articles the
1394 law repealed), 8 (family protection 1391 changes), appeal/cassation thresholds in 10, and 12 (most used rulings).

## Phase 1 staging status (2026-09-30, official source rc.majlis.ir, nothing written to Qdrant)

Staged in the git-ignored `data/raw/phase1/phase1_staged.jsonl`, 586 rows, no missing article numbers:
قانون کار (203), اجرای احکام مدنی (180), حمایت خانواده ۱۳۹۱ (58), تشکیل دادگاه‌های عمومی و انقلاب (38),
روابط موجر و مستأجر ۱۳۵۶ (32), نحوه اجرای محکومیت‌های مالی (29), مسئولیت مدنی (16).

Not staged: کاهش مجازات حبس تعزیری (the splitter mixes quoted penal-code article numbers with the law's own articles);
ثبت اسناد و املاک (the fetched page is titled «مصوب ۲۱ بهمن ۱۳۰۸», probably not the 1310 law); the 1381 amendment of the
courts law (single-article law, must be merged into the base text); rent 1362/1376 and social security (no official id yet).
