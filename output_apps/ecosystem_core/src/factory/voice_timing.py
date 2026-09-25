"""Lightweight, PII-free per-stage timing for the real-time voice pipeline (W7).

Emits one structured JSON log line per stage via the `voice.timing` logger,
gated by the VOICE_TIMING_LOG env flag (default: on -- logs only, no behavior
change). The logger never receives transcript text, prompts, replies or any
other conversation content: only stage names, millisecond durations and small
boolean/numeric flags (e.g. `streamed`). Callers must not pass free-text
fields here.

Stages used by the voice path (see smartjudge_live_voice.py):
    stt_ms, llm_first_token_ms, llm_total_ms, tts_first_byte_ms, tts_total_ms,
    end_to_end_ms
"""

from __future__ import annotations

import json
import logging
import os
import time

logger = logging.getLogger("voice.timing")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

_DISABLE_VALUES = {"0", "false", "off", "no"}


def timing_enabled() -> bool:
    """VOICE_TIMING_LOG defaults to on; only an explicit falsy value disables it."""
    return os.environ.get("VOICE_TIMING_LOG", "1").strip().lower() not in _DISABLE_VALUES


class Stopwatch:
    """A monotonic stopwatch. `elapsed_ms()` can be sampled repeatedly, e.g. once
    for "first byte" and again for "total" on the same call."""

    __slots__ = ("_start",)

    def __init__(self) -> None:
        self._start = time.monotonic()

    def elapsed_ms(self) -> float:
        return round((time.monotonic() - self._start) * 1000, 1)


def log_voice_timing(stage: str, /, **fields: float | int | bool | str | None) -> None:
    """Emit one structured JSON log line for a voice-pipeline stage.

    `stage` is a short name ("stt", "llm", "tts", "turn"). `fields` must only be
    numbers/booleans/short enum-like strings -- never transcript text, prompts
    or replies. A no-op (cheap: one env lookup) when VOICE_TIMING_LOG is off.
    """
    if not timing_enabled():
        return
    payload = {"stage": stage, **{k: v for k, v in fields.items() if v is not None}}
    try:
        logger.info(json.dumps(payload, ensure_ascii=True))
    except Exception:
        # Timing must never break the voice path.
        pass
