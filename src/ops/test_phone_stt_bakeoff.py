"""Offline unit tests for scripts/dev/phone_stt_bakeoff.py (#1116, T293 R30)."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import wave
from pathlib import Path

_MOD = None
_REPO_ROOT = Path(__file__).resolve().parents[2]


def setUpModule() -> None:
    global _MOD
    path = _REPO_ROOT / "scripts" / "dev" / "phone_stt_bakeoff.py"
    spec = importlib.util.spec_from_file_location("phone_stt_bakeoff", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _MOD = mod


class PhoneSttBakeoffTests(unittest.TestCase):
    def test_config_loads_and_rejects_training_discount(self) -> None:
        cfg = _MOD.load_config(_REPO_ROOT / "config" / "phone_stt_bakeoff.json")
        self.assertIn("groq:whisper-large-v3-turbo", cfg["vendors"])
        self.assertIn("speechmatics:enhanced", cfg["vendors"])
        self.assertTrue(cfg["vendors"]["speechmatics:enhanced"]["never_accept_training_discount"])

        with tempfile.TemporaryDirectory() as td:
            bad = Path(td) / "bad.json"
            bad.write_text(
                json.dumps({"vendors": {"x": {"accept_training_discount": True}}}),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                _MOD.load_config(bad)

    def test_synthetic_8khz_wav_and_downsample(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            manifest_path = _MOD.make_synthetic_suite(p / "suite")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["items"]), 6)
            for item in manifest["items"]:
                with wave.open(item["wav"], "rb") as w:
                    self.assertEqual(w.getframerate(), 8000)
                    self.assertEqual(w.getnchannels(), 1)
                    self.assertEqual(w.getsampwidth(), 2)

            # Downsample a 16 kHz mono WAV to 8 kHz
            hi_wav = p / "hi16k.wav"
            with wave.open(str(hi_wav), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(16000)
                w.writeframes(b"\x00\x01" * 1600)
            lo_wav = _MOD.downsample_wav_to_8khz(hi_wav, p / "lo8k.wav")
            with wave.open(str(lo_wav), "rb") as w:
                self.assertEqual(w.getframerate(), 8000)
                self.assertEqual(w.getnframes(), 800)

    def test_eer_and_winner_selection_fa_and_de(self) -> None:
        cfg = _MOD.load_config(_REPO_ROOT / "config" / "phone_stt_bakeoff.json")
        fa_sample = _MOD.SAMPLE_SENTENCES["fa"][0]
        de_sample = _MOD.SAMPLE_SENTENCES["de"][0]

        # groq misses 1 entity out of 6 => EER = 1/6 (~16.7% >= 10% => ineligible)
        # soniox gets all entities right => EER = 0% (< 10% => eligible, cheaper than deepgram)
        # deepgram gets all entities right => EER = 0% (eligible, more expensive)
        outputs = {
            "groq:whisper-large-v3-turbo": [
                {
                    "lang": "fa",
                    "reference": fa_sample["text"],
                    "hypothesis": fa_sample["text"].replace("دادنامه", "دادسرا"),
                    "entities": fa_sample["entities"],
                    "duration_s": 5.0,
                    "latency_ms": 420.0,
                },
                {
                    "lang": "de",
                    "reference": de_sample["text"],
                    "hypothesis": de_sample["text"],
                    "entities": de_sample["entities"],
                    "duration_s": 5.0,
                    "latency_ms": 410.0,
                },
            ],
            "soniox:realtime": [
                {
                    "lang": "fa",
                    "reference": fa_sample["text"],
                    "hypothesis": fa_sample["text"],
                    "entities": fa_sample["entities"],
                    "duration_s": 5.0,
                    "latency_ms": 310.0,
                },
                {
                    "lang": "de",
                    "reference": de_sample["text"],
                    "hypothesis": de_sample["text"],
                    "entities": de_sample["entities"],
                    "duration_s": 5.0,
                    "latency_ms": 290.0,
                },
            ],
            "deepgram:nova-3": [
                {
                    "lang": "fa",
                    "reference": fa_sample["text"],
                    "hypothesis": fa_sample["text"],
                    "entities": fa_sample["entities"],
                    "duration_s": 5.0,
                    "latency_ms": 280.0,
                },
                {
                    "lang": "de",
                    "reference": de_sample["text"],
                    "hypothesis": de_sample["text"],
                    "entities": de_sample["entities"],
                    "duration_s": 5.0,
                    "latency_ms": 270.0,
                },
            ],
        }
        rows = _MOD.score_transcripts(outputs, cfg)
        by_vendor = {r["vendor"]: r for r in rows}
        self.assertFalse(by_vendor["groq:whisper-large-v3-turbo"]["eligible"])
        self.assertTrue(by_vendor["soniox:realtime"]["eligible"])
        self.assertTrue(by_vendor["deepgram:nova-3"]["eligible"])

        winner = _MOD.pick_winner(rows)
        self.assertIsNotNone(winner)
        self.assertEqual(winner["vendor"], "soniox:realtime")
        report = _MOD.render_report(rows, winner, "2026-11-24")
        self.assertIn("soniox:realtime", report)


if __name__ == "__main__":
    unittest.main()
