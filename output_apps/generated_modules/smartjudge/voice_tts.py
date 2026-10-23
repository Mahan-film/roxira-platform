"""Persian text-to-speech with a provider/key fallback chain (leaf module, no app imports).

Chain: edge-tts (free, no key; each voice in ``voices`` once, in order), then Azure AI Speech
(the paid/free-F0 service behind the same ``fa-IR-*Neural`` voices) with every key slot set:
``AZURE_SPEECH_KEY``, ``_2`` .. ``_4``, each paired with ``AZURE_SPEECH_REGION_<n>`` or the
shared ``AZURE_SPEECH_REGION``. Azure is inert unless a key and a region are set, so today's
behaviour (edge-tts only) is unchanged until the owner adds one. A key that answered
429 / 5xx / 401 cools down (key_rotation.py). Key values are never logged.

Other key-holding providers were not added: Gemini TTS does not list Persian, and OpenRouter
has no speech endpoint (2026-10-22).
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
from typing import Optional, Sequence
from xml.sax.saxutils import escape

import httpx

from output_apps.generated_modules.smartjudge.key_rotation import (
    COOLDOWN_NETWORK_S,
    COOLDOWNS,
    KeySlot,
    cooldown_for_status,
    env_slots,
)

DEFAULT_VOICES = ("fa-IR-FaridNeural", "fa-IR-FaridNeural", "fa-IR-DilaraNeural")
ATTEMPT_TIMEOUT_S = 20.0
MIN_AUDIO_BYTES = 200
AZURE_URL = "https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
AZURE_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
_REGION_RE = re.compile(r"^[a-z0-9]{2,32}$")
_RATE_RE = re.compile(r"^[+-]\d{1,3}%$")


def _log(tag: str, msg: str) -> None:
    print(f"[SMARTJUDGE][{tag}] {msg}", file=sys.stderr)


async def edge_mp3(text: str, voice: str, rate: str, timeout: float = ATTEMPT_TIMEOUT_S) -> bytes:
    """One edge-tts synthesis; raises on import/network failure or timeout."""
    import edge_tts

    async def _synth() -> bytes:
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        buf = bytearray()
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                buf.extend(chunk["data"])
        return bytes(buf)

    return await asyncio.wait_for(_synth(), timeout=timeout)


def azure_slots() -> list[tuple[KeySlot, str]]:
    """``(key slot, region)`` for every Azure Speech key with a valid region; [] when unset."""
    shared = os.environ.get("AZURE_SPEECH_REGION", "").strip().lower()
    out: list[tuple[KeySlot, str]] = []
    for slot in env_slots("AZURE_SPEECH_KEY"):
        suffix = slot.name[len("AZURE_SPEECH_KEY"):]  # "" or "_2".."_4"
        region = os.environ.get(f"AZURE_SPEECH_REGION{suffix}", "").strip().lower() or shared
        if _REGION_RE.match(region):
            out.append((slot, region))
    return out


def _ssml(text: str, voice: str, rate: str) -> str:
    rate = rate if _RATE_RE.match(rate or "") else "+0%"
    return (
        "<speak version='1.0' xml:lang='fa-IR'>"
        f"<voice name='{escape(voice, {chr(39): '&apos;'})}'><prosody rate='{rate}'>{escape(text)}</prosody></voice>"
        "</speak>"
    )


async def azure_mp3(
    client: httpx.AsyncClient, slot: KeySlot, region: str, text: str, voice: str, rate: str
) -> Optional[bytes]:
    """One Azure Speech call; None on failure (the key's cooldown is updated)."""
    try:
        resp = await client.post(
            AZURE_URL.format(region=region),
            content=_ssml(text, voice, rate).encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": slot.value,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": AZURE_FORMAT,
                "User-Agent": "roxira-smartjudge",
            },
            timeout=httpx.Timeout(ATTEMPT_TIMEOUT_S, connect=5.0),
        )
    except Exception as exc:
        _log("TTS-AZURE-FAIL", f"{slot.name}: {type(exc).__name__}")
        COOLDOWNS.fail("azure-tts", slot.name, COOLDOWN_NETWORK_S, type(exc).__name__)
        return None
    if resp.status_code == 200 and len(resp.content) > MIN_AUDIO_BYTES:
        COOLDOWNS.ok("azure-tts", slot.name)
        return resp.content
    _log("TTS-AZURE-HTTP", f"{slot.name} -> {resp.status_code}")
    COOLDOWNS.fail(
        "azure-tts", slot.name, cooldown_for_status(resp.status_code, resp.headers.get("retry-after")),
        f"HTTP {resp.status_code}",
    )
    return None


async def fallback_mp3(text: str, voice: str = DEFAULT_VOICES[0], rate: str = "+0%") -> tuple[bytes, str]:
    """The keyed providers only (after edge-tts failed): ``(mp3, provider)`` or ``(b"", "")``."""
    pairs = azure_slots()
    if not pairs:
        return b"", ""
    regions = dict((s.name, r) for s, r in pairs)
    ordered = COOLDOWNS.order("azure-tts", [s for s, _ in pairs])
    async with httpx.AsyncClient() as client:
        for slot in ordered:
            audio = await azure_mp3(client, slot, regions[slot.name], text, voice, rate)
            if audio:
                return audio, "azure-tts"
    return b"", ""


async def synthesize_mp3(
    text: str, voices: Sequence[str] = DEFAULT_VOICES, rate: str = "+22%"
) -> tuple[bytes, str]:
    """MP3 for ``text``: edge-tts voices in order, then the Azure key slots. Never raises.

    Returns ``(audio, provider)``; ``(b"", "")`` when every provider failed.
    """
    if not text:
        return b"", ""
    for voice in voices:
        try:
            audio = await edge_mp3(text, voice, rate)
            if len(audio) > MIN_AUDIO_BYTES:
                return audio, "edge-tts"
        except Exception as exc:
            _log("EDGE-TTS-EXC", f"{voice} {type(exc).__name__}: {exc}")
            if isinstance(exc, ImportError):
                break  # not installed: retrying other voices cannot help
    return await fallback_mp3(text, voices[0] if voices else DEFAULT_VOICES[0], rate)
