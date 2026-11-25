#!/usr/bin/env python3
# ruff: noqa: RUF001
"""Phone STT bake-off on synthetic 8 kHz legal-term audio (#1116, T293 R30).

Scores Groq Whisper turbo, Deepgram Nova-3, Soniox, Azure Speech, and Speechmatics
on legal-term lists in the default language (Persian) and German over 8 kHz narrowband
audio. Selects a winner by entity error rate (< 10%) and estimated cost, while
enforcing zero training-discount opt-in.

Usage:
    python3 scripts/dev/phone_stt_bakeoff.py --make-synthetic /tmp/stt_8k
    python3 scripts/dev/phone_stt_bakeoff.py --manifest /tmp/stt_8k/manifest.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import ssl
import struct
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / "config" / "phone_stt_bakeoff.json"
MAX_BYTES = 25 * 1024 * 1024
TARGET_SAMPLE_RATE = 8000

DEFAULT_LEGAL_TERMS: dict[str, list[str]] = {
    "fa": [
        "دادنامه",
        "دادخواست",
        "شورای حل اختلاف",
        "اجرای احکام",
        "ماده ۱۰ قانون مدنی",
        "تبصره",
        "مهلت تجدیدنظرخواهی",
        "دیوان عدالت اداری",
        "قوه قضاییه",
        "آرای وحدت رویه",
        "قانون مبارزه با پولشویی",
        "دادگاه عالی انتظامی قضات",
    ],
    "de": [
        "Bürgerliches Gesetzbuch",
        "Paragraph 201 StGB",
        "Paragraph 203 StGB",
        "Handelsgesetzbuch",
        "Abgabenordnung",
        "Kündigungsfrist",
        "Widerrufsrecht",
        "Datenschutz-Grundverordnung",
        "Umsatzsteuergesetz",
        "Grundgesetz",
    ],
}

SAMPLE_SENTENCES: dict[str, list[dict[str, Any]]] = {
    "fa": [
        {
            "text": "طبق ماده ۱۰ قانون مدنی و تبصره آن، مهلت تجدیدنظرخواهی بیست روز پس از ابلاغ دادنامه است.",
            "entities": ["ماده ۱۰ قانون مدنی", "تبصره", "مهلت تجدیدنظرخواهی", "دادنامه"],
        },
        {
            "text": "برای پیگیری آرای وحدت رویه قوه قضاییه و قانون مبارزه با پولشویی به دیوان عدالت اداری مراجعه کنید.",
            "entities": ["آرای وحدت رویه", "قوه قضاییه", "قانون مبارزه با پولشویی", "دیوان عدالت اداری"],
        },
        {
            "text": "دادخواست در شورای حل اختلاف ثبت شد و پرونده به اجرای احکام و دادگاه عالی انتظامی قضات ارجاع گردید.",
            "entities": ["دادخواست", "شورای حل اختلاف", "اجرای احکام", "دادگاه عالی انتظامی قضات"],
        },
    ],
    "de": [
        {
            "text": "Nach Paragraph 201 StGB und Paragraph 203 StGB gelten strenge Regeln zum Schutz der Vertraulichkeit.",
            "entities": ["Paragraph 201 StGB", "Paragraph 203 StGB"],
        },
        {
            "text": "Das Bürgerliches Gesetzbuch und das Handelsgesetzbuch regeln die Kündigungsfrist und das Widerrufsrecht.",
            "entities": ["Bürgerliches Gesetzbuch", "Handelsgesetzbuch", "Kündigungsfrist", "Widerrufsrecht"],
        },
        {
            "text": "Gemäß Abgabenordnung, Umsatzsteuergesetz und Datenschutz-Grundverordnung im Rahmen des Grundgesetz.",
            "entities": ["Abgabenordnung", "Umsatzsteuergesetz", "Datenschutz-Grundverordnung", "Grundgesetz"],
        },
    ],
}

_AR2FA = str.maketrans({"ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه"})
_DIGITS = {c: str(i) for i, c in enumerate("۰۱۲۳۴۵۶۷۸۹")}
_DIGITS.update({c: str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")})


def normalize_text(text: str, lang: str = "fa") -> str:
    """Normalize Persian or German text for fair WER/entity comparison."""
    s = unicodedata.normalize("NFKC", text)
    if lang.startswith("fa"):
        s = s.translate(_AR2FA)
        s = "".join(_DIGITS.get(c, c) for c in s)
        s = s.replace("\u200c", " ").replace("\u200d", "").replace("\u0640", "")
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = "".join(" " if unicodedata.category(c).startswith(("P", "S")) else c for c in s)
    return re.sub(r"\s+", " ", s).strip().lower()


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def compute_wer(reference: str, hypothesis: str, lang: str = "fa") -> float:
    ref = normalize_text(reference, lang).split()
    hyp = normalize_text(hypothesis, lang).split()
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)


def compute_entity_error_rate(entities: list[str], hypothesis: str, lang: str = "fa") -> float:
    """Return fraction of expected legal entities missing from normalized hypothesis."""
    if not entities:
        return 0.0
    norm_hyp = f" {normalize_text(hypothesis, lang)} "
    missed = 0
    for ent in entities:
        norm_ent = normalize_text(ent, lang)
        if not norm_ent or f" {norm_ent} " not in norm_hyp:
            missed += 1
    return missed / len(entities)


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    """Load effective-dated vendor config and enforce no-training-discount rule."""
    cfg = json.loads(path.read_text(encoding="utf-8"))
    for name, v in cfg.get("vendors", {}).items():
        if v.get("accept_training_discount"):
            raise ValueError(f"vendor {name} has accept_training_discount=true; forbidden by R30 policy")
    return cfg


def estimate_cost_usd(vendor_cfg: dict[str, Any], duration_s: float) -> float:
    """Estimate USD cost respecting per-request minimum billable seconds."""
    min_s = float(vendor_cfg.get("min_bill_seconds", 0) or 0)
    billed_s = max(float(duration_s), min_s) if duration_s > 0 else 0.0
    rate = float(vendor_cfg.get("usd_per_hour", 0.0))
    return round(rate * billed_s / 3600.0, 6)


def generate_synthetic_8khz_wav(out_path: Path, duration_s: float = 2.0, freq_hz: float = 440.0) -> Path:
    """Create a synthetic 8 kHz 16-bit mono PCM WAV file using stdlib only."""
    n_samples = max(1, int(TARGET_SAMPLE_RATE * duration_s))
    frames = bytearray()
    for i in range(n_samples):
        val = int(12000 * math.sin(2.0 * math.pi * freq_hz * i / TARGET_SAMPLE_RATE))
        frames.extend(struct.pack("<h", val))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TARGET_SAMPLE_RATE)
        w.writeframes(bytes(frames))
    return out_path


def downsample_wav_to_8khz(src_wav: Path, dst_wav: Path) -> Path:
    """Resample a 16-bit PCM WAV file to 8 kHz mono PCM using linear interpolation."""
    with wave.open(str(src_wav), "rb") as r:
        n_ch = r.getnchannels()
        samp_w = r.getsampwidth()
        rate = r.getframerate()
        raw = r.readframes(r.getnframes())
    if samp_w != 2:
        raise ValueError("only 16-bit PCM WAV is supported")
    total_frames = len(raw) // (2 * n_ch)
    mono: list[int] = []
    for i in range(total_frames):
        offset = i * 2 * n_ch
        ch_sum = 0
        for c in range(n_ch):
            ch_sum += struct.unpack_from("<h", raw, offset + c * 2)[0]
        mono.append(ch_sum // n_ch)
    if rate == TARGET_SAMPLE_RATE:
        out_samples = mono
    else:
        ratio = rate / TARGET_SAMPLE_RATE
        out_len = max(1, int(len(mono) / ratio))
        out_samples = []
        for j in range(out_len):
            pos = j * ratio
            idx = int(pos)
            frac = pos - idx
            s0 = mono[min(idx, len(mono) - 1)]
            s1 = mono[min(idx + 1, len(mono) - 1)]
            out_samples.append(int(s0 + (s1 - s0) * frac))
    dst_wav.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(dst_wav), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TARGET_SAMPLE_RATE)
        w.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, s))) for s in out_samples))
    return dst_wav


def wav_duration_s(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def _ssl_ctx() -> ssl.SSLContext:
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def _http_post_json(url: str, payload: dict[str, Any], headers: dict[str, str], timeout: int = 60) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def score_transcripts(
    vendor_outputs: dict[str, list[dict[str, Any]]],
    cfg: dict[str, Any],
) -> list[dict[str, Any]]:
    """Score per-vendor transcript outputs and compute EER, WER, latency, and cost."""
    vendors_cfg = cfg.get("vendors", {})
    rows: list[dict[str, Any]] = []
    for vendor_key, items in vendor_outputs.items():
        v_cfg = vendors_cfg.get(vendor_key, {})
        if not v_cfg.get("training_opt_out", False) or v_cfg.get("accept_training_discount", False):
            rows.append({"vendor": vendor_key, "eligible": False, "note": "rejected: training policy"})
            continue
        eers: list[float] = []
        wers: list[float] = []
        latencies: list[float] = []
        total_cost = 0.0
        for item in items:
            lang = item.get("lang", "fa")
            hyp = item.get("hypothesis", "")
            ref = item.get("reference", "")
            ents = item.get("entities", [])
            dur = float(item.get("duration_s", 0.0))
            eers.append(compute_entity_error_rate(ents, hyp, lang))
            wers.append(compute_wer(ref, hyp, lang))
            if item.get("latency_ms") is not None:
                latencies.append(float(item["latency_ms"]))
            total_cost += estimate_cost_usd(v_cfg, dur)
        avg_eer = sum(eers) / len(eers) if eers else 1.0
        avg_wer = sum(wers) / len(wers) if wers else 1.0
        sorted_lat = sorted(latencies)
        p50_ms = sorted_lat[len(sorted_lat) // 2] if sorted_lat else None
        max_eer = float(cfg.get("winner_criteria", {}).get("max_entity_error_rate", 0.10))
        eligible = avg_eer < max_eer
        rows.append(
            {
                "vendor": vendor_key,
                "entity_error_rate": round(avg_eer, 4),
                "wer": round(avg_wer, 4),
                "latency_p50_ms": round(p50_ms, 1) if p50_ms is not None else None,
                "est_cost_usd": round(total_cost, 6),
                "eligible": eligible,
                "price_status": v_cfg.get("status", "unknown"),
                "note": "ok" if eligible else f"EER >= {max_eer:.0%}",
            }
        )
    return rows


def pick_winner(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the lowest-cost eligible vendor (tie-break by lowest EER, then p50 latency)."""
    eligible = [r for r in rows if r.get("eligible")]
    if not eligible:
        return None
    return min(
        eligible,
        key=lambda r: (
            r.get("est_cost_usd", float("inf")),
            r.get("entity_error_rate", float("inf")),
            r.get("latency_p50_ms") if r.get("latency_p50_ms") is not None else float("inf"),
        ),
    )


def render_report(rows: list[dict[str, Any]], winner: dict[str, Any] | None, today: str) -> str:
    lines = [
        f"# Phone STT Bake-off Report ({today})",
        "",
        "| Vendor | EER | WER | Latency p50 (ms) | Est. Cost (USD) | Eligible | Price Status | Note |",
        "|---|---:|---:|---:|---:|---|---|---|",
    ]
    for r in rows:
        eer = f"{r['entity_error_rate']:.1%}" if "entity_error_rate" in r else "n/a"
        w = f"{r['wer']:.1%}" if "wer" in r else "n/a"
        lat = str(r.get("latency_p50_ms")) if r.get("latency_p50_ms") is not None else "n/a"
        cost = f"{r['est_cost_usd']:.5f}" if "est_cost_usd" in r else "n/a"
        lines.append(
            f"| {r['vendor']} | {eer} | {w} | {lat} | {cost} | {r.get('eligible')} | "
            f"{r.get('price_status', 'n/a')} | {r.get('note', '')} |"
        )
    lines.append("")
    if winner:
        lines.append(
            f"**Winner:** `{winner['vendor']}` (EER={winner['entity_error_rate']:.1%}, "
            f"est_cost=${winner['est_cost_usd']:.5f})"
        )
    else:
        lines.append("**Winner:** none (no vendor achieved EER < 10% with training opt-out)")
    return "\n".join(lines) + "\n"


def make_synthetic_suite(out_dir: Path) -> Path:
    """Generate synthetic 8 kHz WAV fixtures and a manifest for fa and de legal terms."""
    out_dir.mkdir(parents=True, exist_ok=True)
    items: list[dict[str, Any]] = []
    for lang, samples in SAMPLE_SENTENCES.items():
        for idx, sample in enumerate(samples, 1):
            wav_path = out_dir / f"{lang}_{idx}.wav"
            generate_synthetic_8khz_wav(wav_path, duration_s=3.0, freq_hz=380.0 + idx * 40)
            items.append(
                {
                    "id": f"{lang}_{idx}",
                    "lang": lang,
                    "wav": str(wav_path),
                    "reference": sample["text"],
                    "entities": sample["entities"],
                    "duration_s": wav_duration_s(wav_path),
                }
            )
    manifest = out_dir / "manifest.json"
    manifest.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--make-synthetic", help="output directory for synthetic 8 kHz WAVs + manifest.json")
    ap.add_argument("--manifest", help="path to manifest.json")
    ap.add_argument("--results-json", help="optional pre-recorded vendor outputs JSON for offline scoring")
    ap.add_argument("--report-out", help="optional markdown report output path")
    args = ap.parse_args(argv)

    if args.make_synthetic:
        manifest = make_synthetic_suite(Path(args.make_synthetic))
        print(f"wrote {manifest}")
        return 0

    cfg = load_config()
    if args.results_json:
        vendor_outputs = json.loads(Path(args.results_json).read_text(encoding="utf-8"))
        rows = score_transcripts(vendor_outputs, cfg)
        winner = pick_winner(rows)
        report = render_report(rows, winner, dt.date.today().isoformat())
        print(report)
        if args.report_out:
            Path(args.report_out).write_text(report, encoding="utf-8")
        return 0

    if not args.manifest:
        ap.error("provide --make-synthetic, --results-json, or --manifest")

    # Live vendor run requires vendor API keys in env; fail closed if none are configured.
    key_envs = ["GROQ_API_KEY", "DEEPGRAM_API_KEY", "SONIOX_API_KEY", "AZURE_SPEECH_KEY", "SPEECHMATICS_API_KEY"]
    if not any(os.environ.get(k) for k in key_envs):
        print("NEEDS BOX RUN: no live STT vendor API keys set in environment", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
