#!/usr/bin/env python3
# ruff: noqa: RUF001
"""Persian STT bake-off (owner-run). Stdlib only.

Compares AssemblyAI, OpenRouter /audio/transcriptions models and an optional
local mlx-whisper / whisper.cpp CLI on one audio file against a reference
transcript. Prints WER, latency and estimated cost per provider and writes
docs/research/STT_BAKEOFF_<date>.md. Keys come from the environment only
(ASSEMBLYAI_API_KEYS comma-separated, OPENROUTER_API_KEY) and are never
printed. Audio is never printed. Files over 25 MB are refused.

    python3 scripts/dev/stt_bakeoff.py --make-sample
    python3 scripts/dev/stt_bakeoff.py --audio a.wav --ref a.txt --max-usd 0.10
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRICES = ROOT / "config" / "stt_prices.json"
MAX_BYTES = 25 * 1024 * 1024
OR_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
AAI = "https://api.assemblyai.com/v2"
DEFAULT_OR_MODELS = "microsoft/mai-transcribe-2,openai/whisper-large-v3-turbo"

SAMPLE = [
    "سلام، من می‌خواهم درباره قرارداد اجاره خانه سؤال بپرسم.",
    "طبق ماده ۱۰ قانون مدنی، قراردادهای خصوصی نسبت به کسانی که آن را منعقد نموده‌اند نافذ است.",
    "دادگاه تجدیدنظر در تاریخ 15 مهر 1403 رأی خود را صادر کرد.",
    "مهلت اعتراض به دادنامه بیست روز از تاریخ ابلاغ است.",
    "وکیل مدافع لایحه دفاعیه را به دفتر شعبه سوم تقدیم کرد.",
    "خوانده باید مبلغ پانصد میلیون ریال را به همراه خسارت تأخیر تأدیه پرداخت کند.",
    "آیا مهریه عندالمطالبه قابل مطالبه در هر زمان است؟",
    "شماره پرونده یک دو سه چهار پنج شش است و جلسه فردا ساعت 9 صبح برگزار می‌شود.",
    "سند رسمی ملک باید در دفترخانه اسناد رسمی ثبت شود.",
    "متشکرم، لطفاً نتیجه را برای من خلاصه کنید.",
]

_AR2FA = str.maketrans({"ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه"})
_DIGITS = {c: str(i) for i, c in enumerate("۰۱۲۳۴۵۶۷۸۹")}
_DIGITS.update({c: str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")})


def normalize_fa(text: str) -> str:
    """Unify Arabic/Persian letters, strip diacritics/ZWNJ/punctuation, Latin digits."""
    text = unicodedata.normalize("NFKC", text).translate(_AR2FA)
    text = "".join(_DIGITS.get(c, c) for c in text)
    text = text.replace("‌", " ").replace("‍", "").replace("ـ", "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = "".join(" " if unicodedata.category(c).startswith(("P", "S")) else c for c in text)
    return re.sub(r"\s+", " ", text).strip().lower()


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref = normalize_fa(reference).split()
    hyp = normalize_fa(hypothesis).split()
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)


def cer(reference: str, hypothesis: str) -> float:
    ref = list(normalize_fa(reference).replace(" ", ""))
    hyp = list(normalize_fa(hypothesis).replace(" ", ""))
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)


def load_prices(path: Path = PRICES) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["providers"]


def estimate_cost(key: str, seconds: float | None, prices: dict) -> float | None:
    entry = prices.get(key)
    if entry is None or seconds is None:
        return None
    return round(entry["usd_per_hour"] * seconds / 3600.0, 6)


def scrub(text: str, secrets: list[str]) -> str:
    for s in secrets:
        if s:
            text = text.replace(s, "[REDACTED]")
    return text


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def audio_seconds(path: Path, override: float | None) -> float | None:
    if override:
        return override
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as w:
                return w.getnframes() / float(w.getframerate())
        except (wave.Error, EOFError):
            return None
    return None


def check_audio(path: Path) -> None:
    if not path.is_file():
        raise SystemExit(f"audio file not found: {path.name}")
    if path.stat().st_size > MAX_BYTES:
        raise SystemExit("refused: audio file is over 25 MB")


def _http(url, data=None, headers=None, method=None, timeout=300):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as r:
        return r.read()


def run_openrouter(audio: Path, model: str, key: str) -> str:
    body = json.dumps(
        {
            "model": model,
            "language": "fa",
            "input_audio": {
                "data": base64.b64encode(audio.read_bytes()).decode(),
                "format": audio.suffix.lstrip(".").lower() or "wav",
            },
        }
    ).encode()
    raw = _http(
        OR_URL, body, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, "POST"
    )
    return json.loads(raw)["text"]


def run_assemblyai(audio: Path, key: str) -> str:
    h = {"authorization": key}
    up = json.loads(
        _http(
            f"{AAI}/upload",
            audio.read_bytes(),
            {**h, "Content-Type": "application/octet-stream"},
            "POST",
        )
    )
    body = json.dumps(
        {"audio_url": up["upload_url"], "language_code": "fa", "speech_models": ["universal-2"]}
    ).encode()
    job = json.loads(
        _http(f"{AAI}/transcript", body, {**h, "Content-Type": "application/json"}, "POST")
    )
    for _ in range(200):
        r = json.loads(_http(f"{AAI}/transcript/{job['id']}", headers=h))
        if r["status"] == "completed":
            return r.get("text") or ""
        if r["status"] == "error":
            raise RuntimeError("assemblyai error: " + str(r.get("error"))[:200])
        time.sleep(3)
    raise RuntimeError("assemblyai timeout")


def run_local(audio: Path, whisper_model: str | None) -> tuple[str, str]:
    """Return (provider_key, text) using mlx_whisper, else whisper-cli if a model path is given."""
    with tempfile.TemporaryDirectory() as td:
        if shutil.which("mlx_whisper"):
            subprocess.run(
                [
                    "mlx_whisper",
                    str(audio),
                    "--model",
                    "mlx-community/whisper-large-v3-turbo",
                    "--language",
                    "fa",
                    "--output-format",
                    "txt",
                    "--output-dir",
                    td,
                ],
                check=True,
                capture_output=True,
                timeout=1800,
            )
            return "local:mlx-whisper", (Path(td) / f"{audio.stem}.txt").read_text(encoding="utf-8")
        if shutil.which("whisper-cli") and whisper_model:
            out = subprocess.run(
                ["whisper-cli", "-m", whisper_model, "-l", "fa", "-nt", "-f", str(audio)],
                check=True,
                capture_output=True,
                text=True,
                timeout=1800,
            )
            return "local:whisper-cli", out.stdout
    raise RuntimeError("no local engine available")


def render_report(rows: list[dict], audio_name: str, seconds: float | None, today: str) -> str:
    out = [
        f"# STT bake-off {today}",
        "",
        f"Audio: `{audio_name}` ({seconds:.1f}s)" if seconds else f"Audio: `{audio_name}`",
        "",
        "| Provider | WER | CER | Latency s | Est. cost USD | Price verified | Note |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        f = lambda v, p: "n/a" if v is None else f"{v:.{p}f}"  # noqa: E731
        out.append(
            f"| {r['provider']} | {f(r.get('wer'), 3)} | {f(r.get('cer'), 3)} | "
            f"{f(r.get('latency'), 1)} | {f(r.get('cost'), 5)} | "
            f"{r.get('verified', '?')} | {r.get('note', '')} |"
        )
    out += [
        "",
        "WER is computed after Persian normalisation. Transcripts are not stored in this report.",
    ]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--make-sample", action="store_true", help="print Persian sentences to read aloud"
    )
    ap.add_argument("--audio")
    ap.add_argument("--ref", help="reference transcript text file")
    ap.add_argument("--duration-s", type=float, help="needed for non-wav audio cost estimates")
    ap.add_argument("--max-usd", type=float, default=0.05)
    ap.add_argument("--or-models", default=DEFAULT_OR_MODELS)
    ap.add_argument("--whisper-cpp-model", help="ggml model path for whisper-cli")
    ap.add_argument("--no-report", action="store_true")
    a = ap.parse_args(argv)

    if a.make_sample:
        print("\n".join(SAMPLE))
        print(
            "\n# Read these aloud in one take (~1-2 min), save as WAV/MP3/M4A (<25 MB),"
            " and save the lines above as the reference .txt.",
            file=sys.stderr,
        )
        return 0
    if not a.audio or not a.ref:
        ap.error("--audio and --ref are required (or use --make-sample)")

    audio = Path(a.audio)
    check_audio(audio)
    reference = Path(a.ref).read_text(encoding="utf-8")
    prices = load_prices()
    secs = audio_seconds(audio, a.duration_s)
    aai_keys = [
        k.strip() for k in os.environ.get("ASSEMBLYAI_API_KEYS", "").split(",") if k.strip()
    ]
    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    secrets = [*aai_keys, or_key]

    jobs = []
    if aai_keys:
        jobs.append(("assemblyai:universal-2", lambda: run_assemblyai(audio, aai_keys[0])))
    if or_key:
        for m in [x.strip() for x in a.or_models.split(",") if x.strip()]:
            jobs.append((f"openrouter:{m}", lambda m=m: run_openrouter(audio, m, or_key)))
    if shutil.which("mlx_whisper") or (shutil.which("whisper-cli") and a.whisper_cpp_model):
        jobs.append(("local", lambda: run_local(audio, a.whisper_cpp_model)))
    if not jobs:
        print(
            "No providers available: set ASSEMBLYAI_API_KEYS or OPENROUTER_API_KEY, "
            "or install mlx_whisper."
        )
        return 1

    spent, rows = 0.0, []
    for key, fn in jobs:
        est = estimate_cost(key, secs, prices) if key != "local" else 0.0
        if est is not None and spent + est > a.max_usd:
            rows.append({"provider": key, "note": f"skipped: would exceed --max-usd {a.max_usd}"})
            continue
        t0 = time.monotonic()
        try:
            res = fn()
            if key == "local":
                key, res = res
                est = 0.0
            text = res
        except (
            urllib.error.URLError,
            RuntimeError,
            subprocess.SubprocessError,
            KeyError,
            ValueError,
            OSError,
        ) as e:
            rows.append(
                {
                    "provider": key,
                    "note": "error: " + scrub(f"{type(e).__name__}: {e}", secrets)[:160],
                }
            )
            continue
        spent += est or 0.0
        rows.append(
            {
                "provider": key,
                "wer": wer(reference, text),
                "cer": cer(reference, text),
                "latency": time.monotonic() - t0,
                "cost": est,
                "verified": prices.get(key, {}).get("verified", "unpriced"),
            }
        )
    today = dt.date.today().isoformat()
    report = render_report(rows, audio.name, secs, today)
    print(report)
    if not a.no_report:
        p = ROOT / "docs" / "research" / f"STT_BAKEOFF_{today}.md"
        p.write_text(report, encoding="utf-8")
        print(f"wrote {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
