# STT Persian benchmark (local vs remote Whisper)

`scripts/stt_bench.py` compares the locally hosted `faster-whisper` engine
against the remote OpenRouter Whisper path on short Persian clips, reporting
mean word error rate (WER) and p50/p95 decode latency per engine. It is the
measurement gate for enabling `ROXIRA_STT_LOCAL` (see
`docs/research/STT_PERSIAN_RESEARCH_2026-10.md` and `docs/W15_stt_plan.md`).

The script never changes production state. It only reads a folder of clips and
prints a table; with `--out` it also writes the full JSON report.

## 1. Record 10 sample sentences

Record the owner's real voice, not synthesized audio. Keep it consented and
non-production: **never commit the audio or reference text** — it is case-like
personal data.

Cover these short-turn categories, one clip each (10 total):

| # | Intent | Example reference sentence |
|---|---|---|
| 1 | Greeting | سلام، تو کی هستی |
| 2 | Identity | اسم من علی است |
| 3 | Legal term | دادخواست را ثبت کنید |
| 4 | Legal term | رأی وحدت رویه صادر شد |
| 5 | Legal term | لایحه دفاعیه آماده است |
| 6 | Digits | شماره پرونده ۱۲۳۴ است |
| 7 | Compound word | تعیین تکلیف پرونده |
| 8 | English term | صدا به متن را فعال کن |
| 9 | Noisy room | لطفاً یک بار دیگر تکرار کنید |
| 10 | Accent | قوه قضائیه پاسخ داد |

For each clip save two files with the **same stem** in one folder:

```
samples/
  greeting.wav      greeting.txt      # .txt is the exact UTF-8 reference text
  identity.wav      identity.txt
  ...
```

Record at **16 kHz, mono, 16-bit PCM WAV** (matches the server's
`convert_to_wav_pcm` target). On macOS one way:

```sh
# QuickTime records .m4a; convert to 16k mono wav:
ffmpeg -i greeting.m4a -ar 16000 -ac 1 -c:a pcm_s16le greeting.wav
```

Write `greeting.txt` with the exact words you said (persian digits are fine;
the script normalizes digits, ی/ي, ک/ك and ZWNJ before scoring).

## 2. Run on the Mac

Local engine needs `faster-whisper` installed in the active Python environment;
remote needs `OPENROUTER_API_KEY` exported. A missing dependency/key only skips
that engine with a warning, so `--engines local` works with no key at all.

```sh
# both engines (remote is skipped if OPENROUTER_API_KEY is unset)
python3 scripts/stt_bench.py --dir samples --engines local,remote --out /tmp/stt_result.json

# local only — no key, fully offline once weights are cached
python3 scripts/stt_bench.py --dir samples --engines local
```

The first local run downloads the configured local model's weights (about
1.6 GB) and is slow; later runs use the cache. The model is selected by
`ROXIRA_STT_LOCAL_MODEL` (see `output_apps/ecosystem_core/src/factory/stt_local_whisper.py`).

## 3. Run on the server

Run inside the app container so it uses the container's Python, cached model
and `.env` key (see `docs/STRATEGY.md` §7 for how the container gets `.env`).
This is read-only with respect to application state.

```sh
# copy the clips to the server first, then:
docker exec -w /app roxira_app_prod \
    python3 scripts/stt_bench.py --dir /tmp/stt_samples --engines local,remote
```

Do not wire this into cron or CI: it is an owner-run decision, not a monitor.

## 4. Read the result

```
engine       n  mean_wer   p50_ms   p95_ms
local       10     0.083     980.4   1830.2
remote      10     0.121     740.1   1280.5
```

- `mean_wer` — average per-clip WER; lower is better. Compare like with like:
  the same clips, references and normalisation for every engine.
- `p50_ms` / `p95_ms` — decode latency only (file read to transcript); capture
  and VAD time are out of scope here.
- The full JSON (`--out`) also carries the per-sample WER/latency rows, for a
  failing clip to be inspected individually.

Promotion is a measured decision, not a latency-only one: follow the acceptance
gate in `docs/research/STT_PERSIAN_RESEARCH_2026-10.md` (beat the remote
baseline on normalized WER and exact short-phrase intent, zero end-clipped gold
phrases, within the agreed CPU p95 budget) before setting `ROXIRA_STT_LOCAL=1`.
