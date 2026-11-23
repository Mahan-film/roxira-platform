# Phone eval: before and after the box-side fixes (2026-11-22)

Set: `data/eval/chat_golden/phone_owner_2026-11-21.json` (#987). It holds six of the owner's questions from the 2026-11-21 phone call. All key points are TO-VERIFY: no lawyer has checked them.

Box fixes measured here:

- #1042: STT term repair and the echo fix that had cut the last question.
- #1280 (#989), the no-source notice: this shows up only on the phone and does not change the text Smart Judge returns.

## 1. Offline STT metric (deterministic, 0 API calls)

What Smart Judge receives is the transcript after the phone agent's `clean()` and repair, then after the server's own `repair_legal_phonetics`. For each case the metric checks two things:

- **Key terms:** are the question's key legal terms present?
- **Catalog intent:** does the server's `catalog_intent.detect` fire where a "latest" question needs it?

| Case | Key terms, before → after | "Latest" catalog intent, before → after |
|---|---|---|
| latest judiciary circulars | n → Y (قول به غذایی → قوه قضاییه) | Y → Y |
| disciplinary offences, judges and lawyers | n → Y (قضاک, تخلافات) | - |
| latest anti-money-laundering law | n → Y (موردان برشویش) | - |
| latest unity rulings | n → Y (عدی بستا سویه) | n → **Y** |
| what can you write | - | - |
| fight in a public vs private place | first half cut by echo removal → whole question kept | - |
| **Total** | **0/4 → 4/4** (plus 0/1 → 1/1 question kept whole) | **1/2 → 2/2** |

"Before" is the raw `stt_heard` from the call. The echo row is the regression test in #1042, run on the real call text.

## 2. Live answers, voice mode

**Before** is the logged replies from the 2026-11-21 call, scored with `--offline-answers`. Caveats:

- the call went through the phone gateway tier, not the anonymous tier;
- the logged replies are cut at 300 characters.

**After** is 5 anonymous voice-mode calls to the public chat API on 2026-11-22, using the transcripts the agent now sends. Anonymous chat allows 5 a day per IP, so "what can you write" was left out.

| Case | Before: key points / forbidden hits | After: key points / forbidden hits | After: note |
|---|---|---|---|
| latest unity rulings | 0/3, 2 (echoed the STT error, "not found") | **3/3, 0: PASS** | catalog path, real ruling number and date, 3 sources |
| disciplinary offences | 1/4, 1 ("not in my sources") | 0/4, 0 | retrieval returned the wrong law (قانون ثبت, articles 40 and 73), a corpus gap |
| latest anti-money-laundering law | 0/2, 1 (clarifying question) | no data | free tier "busy" reply (`upsell: true`) |
| latest judiciary circulars | 1/2, 1 (echoed the STT error) | no data | free tier "busy" reply |
| fight, public vs private place | 1/2, 1 (clarifying question) | no data | free tier "busy" reply |
| what can you write | 1/2, 0 | not run | daily cap |
| **Pass** | **0/6** | **1/2 with data** (3 busy, 1 not run) | |

What this says:

- **STT was a real cause.** With the repaired words, the unity-rulings question goes from a non-answer to a correct catalog answer.
- **Corpus is the next cause.** The disciplinary question gets a confident answer from the wrong law. This is the main hub's T257 #996 and the ASK-HUB on #965.
- **The anonymous free tier was exhausted** for three of the five calls. The phone line runs on its own gateway tier, so this "after" arm understates the phone. A proper paired run, both arms on the same tier with an eval token, is asked of the main hub.

## 3. Commands

- **Seed check:** `python3 scripts/eval_chat_golden.py --set data/eval/chat_golden/phone_owner_2026-11-21.json --validate`.
- **Live run, voice mode, on a host where you have quota:** the same command with `--voice --base-url https://<host>` instead of `--validate`. The public URL needs the User-Agent fix in this PR.
- **Before arm:** the same set with `--offline-answers <file of logged replies>`.
- **Offline STT metric:** two short helper scripts on the box (`~/.cache/sj-diag/stt_metric.ts` and `stt_metric.py`, user `mahanfilms`). The first runs the agent's `clean()` on each `stt_heard`; the second applies the server's `repair_legal_phonetics` and `catalog_intent.detect`. They move into the nightly eval (#987) when it is built.
- **Live response bodies:** the 5 bodies are kept on the box (`~/.cache/sj-diag/live_after.json`), not in git.
