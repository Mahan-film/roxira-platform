"""Persian speech-to-text for the website voice buttons (leaf module, no app imports).

Shared by ``POST /transcribe-audio`` (mic button) and the live-voice websocket.

Why this exists (docs/ops/VOICE_DIAGNOSIS_2026-10-11.md):
  * the old code tried up to 4 sequential 20 s OpenRouter calls and then ran the
    local faster-whisper model *synchronously inside the event loop*, so one long
    clip froze the whole server and the phone saw "Load failed" / a 90 s timeout;
  * a failed provider and a silent clip both ended as the same 502.

Now: one wall-clock budget, a model chain read from ``config/models.yaml``
(``stt`` role), logged HTTP statuses, a local fallback that runs in a worker
thread and stops at the deadline, and a result that says whether any provider
was actually reachable.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import httpx

OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

# Wall-clock budget for one transcription. The browser waits STT_TIMEOUT_MS
# (100 s, lib/api/judge-chat-client.ts); stay well under it.
TOTAL_BUDGET_S = float(os.environ.get("VOICE_STT_BUDGET_S", "") or 80.0)
# Remote providers get this share of the budget; the rest is kept for the local model.
REMOTE_SHARE = 0.55
REMOTE_ATTEMPT_TIMEOUT_S = 30.0
CONNECT_TIMEOUT_S = 5.0
LOCAL_MIN_BUDGET_S = 8.0
# Below this many bytes (~1 s of compressed speech) an empty answer is believed at once.
MIN_BYTES_FOR_SECOND_OPINION = 16_000

_FALLBACK_CHAIN = ["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"]
_MAX_REMOTE_MODELS = 3

_MIME = {
    "wav": "audio/wav",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "webm": "audio/webm",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
}

_PROMPT = "درخواست و دادخواست حقوقی، ماده قانون، دادگاه، رای وحدت رویه، سرقفلی"


@dataclass
class SttResult:
    text: str = ""
    # True when some provider answered successfully (an empty text then means silence).
    reachable: bool = False
    provider: str = ""
    error: str = ""


def upload_mime(ext: str) -> str:
    return _MIME.get(ext, "audio/mp4")


def stt_model_chain() -> list[str]:
    """Whisper-style ids from the registry's ``stt`` role (primary first); never raises.

    Chat-completion audio models (``openai/gpt-audio``) need a different request
    shape and are skipped here.
    """
    ids: list[str] = []
    try:
        from output_apps.generated_modules.smartjudge import model_registry

        ids = [m for m in model_registry.role_models("stt") if "whisper" in m.lower()]
    except Exception:
        ids = []
    if not ids:
        ids = list(_FALLBACK_CHAIN)
    out: list[str] = []
    for m in ids:
        if m not in out:
            out.append(m)
    return out[:_MAX_REMOTE_MODELS]


def _log(tag: str, msg: str) -> None:
    print(f"[SMARTJUDGE][{tag}] {msg}", file=sys.stderr)


def extract_text(data: object) -> str:
    """Text from a /audio/transcriptions or chat/completions style JSON body."""
    if not isinstance(data, dict):
        return ""
    if isinstance(data.get("text"), str):
        return data["text"].strip()
    choices = data.get("choices") or []
    if choices:
        content = (choices[0].get("message") or {}).get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return "".join(
                (p.get("text") or "") for p in content if isinstance(p, dict) and p.get("type") in (None, "text")
            ).strip()
    return ""


async def _remote_one(
    client: httpx.AsyncClient, headers: dict, model: str, audio: bytes, ext: str, deadline: float
) -> tuple[Optional[str], str]:
    """One model: JSON/base64 first, multipart only if the server rejected the JSON shape.

    Returns ``(text, why)``; ``text is None`` means this model failed (try the next one),
    ``""`` means the provider answered but heard nothing.
    """
    import base64

    def remaining() -> float:
        return deadline - time.monotonic()

    why = ""
    if remaining() < 2:
        return None, "budget"
    body = {"model": model, "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": ext}, "language": "fa"}
    try:
        resp = await client.post(
            OPENROUTER_TRANSCRIPTION_URL, json=body, headers=headers,
            timeout=httpx.Timeout(min(REMOTE_ATTEMPT_TIMEOUT_S, max(remaining(), 1.0)), connect=CONNECT_TIMEOUT_S),
        )
        if resp.status_code == 200:
            return extract_text(resp.json()), "ok"
        why = f"json HTTP {resp.status_code}"
        _log("STT-HTTP", f"{model} json -> {resp.status_code}")
        if resp.status_code not in (400, 415, 422):
            return None, why  # rate limit / outage: another shape will not help
    except Exception as exc:
        _log("STT-FAIL-JSON", f"{model}: {type(exc).__name__} {exc}")
        return None, f"json {type(exc).__name__}"

    if remaining() < 2:
        return None, why
    try:
        resp = await client.post(
            OPENROUTER_TRANSCRIPTION_URL,
            data={"model": model, "language": "fa", "prompt": _PROMPT},
            files={"file": (f"speech.{ext}", audio, upload_mime(ext))},
            headers=headers,
            timeout=httpx.Timeout(min(REMOTE_ATTEMPT_TIMEOUT_S, max(remaining(), 1.0)), connect=CONNECT_TIMEOUT_S),
        )
        if resp.status_code == 200:
            return extract_text(resp.json()), "ok"
        _log("STT-HTTP", f"{model} multipart -> {resp.status_code}")
        return None, f"multipart HTTP {resp.status_code}"
    except Exception as exc:
        _log("STT-FAIL-MULTIPART", f"{model}: {type(exc).__name__} {exc}")
        return None, f"multipart {type(exc).__name__}"


async def _assemblyai(client: httpx.AsyncClient, keys: list[str], audio: bytes, deadline: float) -> Optional[str]:
    for key in keys:
        auth = {"authorization": key}
        try:
            up = await client.post("https://api.assemblyai.com/v2/upload", content=audio, headers=auth,
                                   timeout=httpx.Timeout(20.0, connect=CONNECT_TIMEOUT_S))
            url = up.json().get("upload_url") if up.status_code == 200 else None
            if not url:
                continue
            tr = await client.post("https://api.assemblyai.com/v2/transcript",
                                   json={"audio_url": url, "language_code": "fa"}, headers=auth, timeout=15.0)
            tid = tr.json().get("id") if tr.status_code == 200 else None
            while tid and time.monotonic() < deadline:
                await asyncio.sleep(1.0)
                poll = await client.get(f"https://api.assemblyai.com/v2/transcript/{tid}", headers=auth, timeout=15.0)
                if poll.status_code != 200:
                    break
                data = poll.json()
                if data.get("status") == "completed":
                    return (data.get("text") or "").strip()
                if data.get("status") == "error":
                    break
        except Exception as exc:
            _log("STT-ASSEMBLY-FAIL", f"{type(exc).__name__} {exc}")
    return None


_local_model = None
_local_lock = threading.Lock()


def _get_local_model():
    """faster-whisper "base" (cached in the image); False after one failed load."""
    global _local_model
    with _local_lock:
        if _local_model is None:
            try:
                from faster_whisper import WhisperModel

                _local_model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=4)
            except Exception as exc:
                _log("STT-LOCAL-FAIL", f"load: {type(exc).__name__} {exc}")
                _local_model = False
        return _local_model or None


def _local_transcribe_blocking(audio: bytes, ext: str, deadline: float) -> str:
    model = _get_local_model()
    if model is None:
        return ""
    path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(audio)
            path = tmp.name
        segments, _info = model.transcribe(path, language="fa", beam_size=1, vad_filter=True)
        parts: list[str] = []
        for seg in segments:  # lazy generator: stop at the deadline, keep what we have
            parts.append(seg.text)
            if time.monotonic() > deadline:
                _log("STT-LOCAL-PARTIAL", "stopped at deadline")
                break
        return " ".join(p.strip() for p in parts).strip()
    except Exception as exc:
        _log("STT-LOCAL-FAIL", f"{type(exc).__name__} {exc}")
        return ""
    finally:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass


async def transcribe(
    audio: bytes,
    ext: str,
    *,
    api_key: str = "",
    assembly_keys: Optional[list[str]] = None,
    local_fallback: Optional[Callable[[bytes, str, float], str]] = _local_transcribe_blocking,
    budget_s: Optional[float] = None,
) -> SttResult:
    """Transcribe Persian speech. Never raises."""
    if not audio:
        return SttResult(error="empty")
    started = time.monotonic()
    total = budget_s if budget_s is not None else TOTAL_BUDGET_S
    deadline = started + total
    remote_deadline = started + total * REMOTE_SHARE
    last_error = ""
    empty_reachable = False

    if api_key:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "https://ghazihoushmand.ir",
            "X-Title": "Roxira SmartJudge",
        }
        try:
            async with httpx.AsyncClient() as client:
                for model in stt_model_chain():
                    if time.monotonic() >= remote_deadline - 2:
                        break
                    text, why = await _remote_one(client, headers, model, audio, ext, remote_deadline)
                    if text is not None:
                        if text:
                            _log("STT-OK", f"{model} {int((time.monotonic() - started) * 1000)}ms")
                            return SttResult(text=text, reachable=True, provider=model)
                        # Empty answer: for a clip longer than ~1 s a flaky provider may be
                        # swallowing speech, so ask the next model before declaring silence.
                        empty_reachable = True
                        if len(audio) <= MIN_BYTES_FOR_SECOND_OPINION:
                            return SttResult(text="", reachable=True, provider=model)
                        last_error = f"{model}: empty"
                        continue
                    last_error = f"{model}: {why}"
                keys = [k for k in (assembly_keys or []) if k]
                if keys:
                    text = await _assemblyai(client, keys, audio, remote_deadline)
                    if text:
                        return SttResult(text=text, reachable=True, provider="assemblyai")
                    if text is not None:
                        empty_reachable = True
        except Exception as exc:  # defensive: transport setup errors
            last_error = f"{type(exc).__name__}"
            _log("STT-FAIL", last_error)
    else:
        last_error = "no OPENROUTER_API_KEY"

    if local_fallback is not None and deadline - time.monotonic() >= LOCAL_MIN_BUDGET_S:
        try:
            # worker thread: the event loop (and every other user) keeps running
            text = await asyncio.to_thread(local_fallback, audio, ext, deadline)
        except Exception as exc:
            text = ""
            _log("STT-LOCAL-FAIL", f"{type(exc).__name__} {exc}")
        if text:
            _log("STT-LOCAL-SUCCESS", f"{int((time.monotonic() - started) * 1000)}ms")
            return SttResult(text=text, reachable=True, provider="local-whisper")
        last_error = last_error or "local model returned nothing"
    if empty_reachable:
        return SttResult(text="", reachable=True, error="no speech")
    return SttResult(error=last_error or "unavailable")
