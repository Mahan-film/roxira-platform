"""Persian speech-to-text for the website voice buttons (leaf module, no app imports).

Shared by ``POST /transcribe-audio`` (mic button) and the live-voice websocket.

Why this exists (docs/ops/VOICE_DIAGNOSIS_2026-10-11.md):
  * the old code tried up to 4 sequential 20 s OpenRouter calls and then ran the
    local faster-whisper model *synchronously inside the event loop*, so one long
    clip froze the whole server and the phone saw "Load failed" / a 90 s timeout;
  * a failed provider and a silent clip both ended as the same 502.

Now: one wall-clock budget, logged HTTP statuses, a local fallback that runs in a
worker thread and stops at the deadline, and a result that says whether any provider
was actually reachable.

Remote chain (owner decision 2026-10-22: use every key, as fallback and concurrently).
Default order is what production ran before: OpenRouter Whisper, then AssemblyAI. The wider chain
(e.g. ``VOICE_STT_ORDER=assemblyai,groq,mistral,openrouter,gemini``) and hedging
(``VOICE_STT_HEDGE=1``: start the next attempt alongside a slow one) are opt-in. Each provider uses every key slot set in the
environment (``<PROVIDER>_API_KEY``, ``_2`` .. ``_4``; see key_rotation.py). A key that
answered 429 / 5xx / 401 cools down and goes to the back of its provider's list. When an
attempt is slow, the next one starts alongside it (a hedge), but never a second billed call
while a billed one is in flight. Native model ids come from ``config/models.yaml``
(``stt`` role for OpenRouter, ``stt_direct`` for the rest). Key values are never logged;
log lines carry the env var name of the slot.
"""

from __future__ import annotations

import asyncio
import base64
import os
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

import httpx

from output_apps.generated_modules.smartjudge.key_rotation import (
    COOLDOWN_NETWORK_S,
    COOLDOWNS,
    KeySlot,
    cooldown_for_status,
    env_slots,
    merge_slots,
)

OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions"
GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MISTRAL_TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions"
GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
ASSEMBLYAI_URL = "https://api.assemblyai.com/v2"

# Production order before the multi-key change: OpenRouter Whisper chain, then AssemblyAI. The wider
# chain (AssemblyAI -> Groq -> Mistral -> OpenRouter -> Gemini) is opt-in: VOICE_STT_ORDER=assemblyai,groq,...
DEFAULT_ORDER = "openrouter,assemblyai"

# Wall-clock budget for one transcription. The browser waits STT_TIMEOUT_MS
# (100 s, lib/api/judge-chat-client.ts); stay well under it.
TOTAL_BUDGET_S = float(os.environ.get("VOICE_STT_BUDGET_S", "") or 80.0)
# Remote providers get this share of the budget; the rest is kept for the local model.
REMOTE_SHARE = 0.55
REMOTE_ATTEMPT_TIMEOUT_S = 30.0
CONNECT_TIMEOUT_S = 5.0
LOCAL_MIN_BUDGET_S = 8.0
# Start the next attempt alongside a slow one after this long (VOICE_STT_HEDGE_S).
HEDGE_AFTER_S = float(os.environ.get("VOICE_STT_HEDGE_S", "") or 4.0)
MAX_IN_FLIGHT = 2
ASSEMBLYAI_POLL_S = 1.0
# Below this many bytes (~1 s of compressed speech) an empty answer is believed at once.
MIN_BYTES_FOR_SECOND_OPINION = 16_000

_FALLBACK_CHAIN = ["openai/whisper-large-v3", "openai/whisper-large-v3-turbo"]
_MAX_REMOTE_MODELS = 3
# Used only when config/models.yaml cannot be read (role ``stt_direct``).
_FALLBACK_DIRECT = ["groq:whisper-large-v3", "mistral:voxtral-mini-latest", "gemini:gemini-flash-latest"]

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

# Gemini lists audio/aac rather than audio/mp4 for AAC-in-MP4 clips (m4a from iOS).
_GEMINI_MIME = {"m4a": "audio/aac", "mp4": "audio/aac", "mp3": "audio/mp3", "opus": "audio/ogg"}
_GEMINI_INSTRUCTION = (
    "Transcribe this Persian (Farsi) audio verbatim in Persian script. Output only the "
    "transcript, no translation or commentary. If there is no speech, output nothing."
)

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


@dataclass
class _Outcome:
    """One provider call. ``text is None`` = failed (try the next attempt), ``""`` = heard nothing."""

    text: Optional[str]
    why: str = ""
    status: int = 0  # HTTP status that ended the call (0: none / not an HTTP failure)
    retry_after: Optional[str] = None
    transient: bool = False  # network error / timeout: cool the key down briefly


def _http_fail(resp: httpx.Response, what: str) -> _Outcome:
    return _Outcome(None, f"{what} HTTP {resp.status_code}", resp.status_code, resp.headers.get("retry-after"))


def _timeout(deadline: float, cap: float = REMOTE_ATTEMPT_TIMEOUT_S) -> httpx.Timeout:
    return httpx.Timeout(min(cap, max(deadline - time.monotonic(), 1.0)), connect=CONNECT_TIMEOUT_S)


async def _openrouter_one(
    client: httpx.AsyncClient, key: str, model: str, audio: bytes, ext: str, deadline: float
) -> _Outcome:
    """OpenRouter: JSON/base64 first, multipart only if the server rejected the JSON shape."""
    headers = {
        "Authorization": f"Bearer {key}",
        "HTTP-Referer": "https://ghazihoushmand.ir",
        "X-Title": "Roxira SmartJudge",
    }
    body = {"model": model, "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": ext}, "language": "fa"}
    resp = await client.post(OPENROUTER_TRANSCRIPTION_URL, json=body, headers=headers, timeout=_timeout(deadline))
    if resp.status_code == 200:
        return _Outcome(extract_text(resp.json()), "ok")
    if resp.status_code not in (400, 415, 422):
        return _http_fail(resp, "json")  # rate limit / outage: another shape will not help
    if deadline - time.monotonic() < 2:
        return _http_fail(resp, "json")
    resp = await client.post(
        OPENROUTER_TRANSCRIPTION_URL,
        data={"model": model, "language": "fa", "prompt": _PROMPT},
        files={"file": (f"speech.{ext}", audio, upload_mime(ext))},
        headers=headers,
        timeout=_timeout(deadline),
    )
    if resp.status_code == 200:
        return _Outcome(extract_text(resp.json()), "ok")
    return _http_fail(resp, "multipart")


async def _openai_multipart(
    client: httpx.AsyncClient, url: str, key: str, form: dict, audio: bytes, ext: str, deadline: float
) -> _Outcome:
    """OpenAI-compatible ``/audio/transcriptions`` (Groq, Mistral)."""
    resp = await client.post(
        url,
        data=form,
        files={"file": (f"speech.{ext}", audio, upload_mime(ext))},
        headers={"Authorization": f"Bearer {key}"},
        timeout=_timeout(deadline),
    )
    if resp.status_code == 200:
        return _Outcome(extract_text(resp.json()), "ok")
    return _http_fail(resp, "multipart")


async def _groq_one(client: httpx.AsyncClient, key: str, model: str, audio: bytes, ext: str, deadline: float) -> _Outcome:
    form = {"model": model, "language": "fa", "prompt": _PROMPT, "response_format": "json", "temperature": "0"}
    return await _openai_multipart(client, GROQ_TRANSCRIPTION_URL, key, form, audio, ext, deadline)


async def _mistral_one(client: httpx.AsyncClient, key: str, model: str, audio: bytes, ext: str, deadline: float) -> _Outcome:
    # No language hint: "fa" is not on Voxtral's documented list and could be rejected.
    return await _openai_multipart(client, MISTRAL_TRANSCRIPTION_URL, key, {"model": model}, audio, ext, deadline)


async def _gemini_one(client: httpx.AsyncClient, key: str, model: str, audio: bytes, ext: str, deadline: float) -> _Outcome:
    """Gemini ``generateContent`` with the clip inline (fine below the 20 MB request limit)."""
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": _GEMINI_INSTRUCTION},
            {"inline_data": {"mime_type": _GEMINI_MIME.get(ext, upload_mime(ext)), "data": base64.b64encode(audio).decode("ascii")}},
        ]}],
        "generationConfig": {"temperature": 0},
    }
    resp = await client.post(
        GEMINI_GENERATE_URL.format(model=model), json=body, headers={"x-goog-api-key": key}, timeout=_timeout(deadline)
    )
    if resp.status_code != 200:
        return _http_fail(resp, "generate")
    data = resp.json() if resp.content else {}
    candidates = data.get("candidates") or [] if isinstance(data, dict) else []
    parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
    return _Outcome("".join(p.get("text") or "" for p in parts if isinstance(p, dict)).strip(), "ok")


async def _assemblyai_one(client: httpx.AsyncClient, key: str, model: str, audio: bytes, ext: str, deadline: float) -> _Outcome:
    """Upload, create a transcript, poll until done or the deadline."""
    auth = {"authorization": key}
    up = await client.post(f"{ASSEMBLYAI_URL}/upload", content=audio, headers=auth, timeout=_timeout(deadline, 20.0))
    if up.status_code != 200:
        return _http_fail(up, "upload")
    url = (up.json() or {}).get("upload_url")
    if not url:
        return _Outcome(None, "upload: no url")
    tr = await client.post(f"{ASSEMBLYAI_URL}/transcript", json={"audio_url": url, "language_code": "fa"},
                           headers=auth, timeout=_timeout(deadline, 15.0))
    if tr.status_code != 200:
        return _http_fail(tr, "transcript")
    tid = (tr.json() or {}).get("id")
    while tid and time.monotonic() < deadline:
        await asyncio.sleep(ASSEMBLYAI_POLL_S)
        poll = await client.get(f"{ASSEMBLYAI_URL}/transcript/{tid}", headers=auth, timeout=_timeout(deadline, 15.0))
        if poll.status_code != 200:
            return _http_fail(poll, "poll")
        data = poll.json() or {}
        if data.get("status") == "completed":
            return _Outcome((data.get("text") or "").strip(), "ok")
        if data.get("status") == "error":
            return _Outcome(None, "transcript error")  # the clip, not the key
    return _Outcome(None, "budget")


_CallFn = Callable[[httpx.AsyncClient, str, str, bytes, str, float], Awaitable[_Outcome]]


@dataclass(frozen=True)
class _Provider:
    call: _CallFn
    key_base: str  # env var holding the first key; _2.._4 are the spare slots
    billed: bool  # paid per call: never run two billed attempts at once (no double billing)
    list_env: str = ""


# Free tiers (Groq, Mistral Experiment, Gemini AI Studio) are not billed per call; AssemblyAI
# spends prepaid credit per audio second and OpenRouter is paid, so those are "billed".
_PROVIDERS: dict[str, _Provider] = {
    "assemblyai": _Provider(_assemblyai_one, "ASSEMBLYAI_API_KEY", billed=True, list_env="ASSEMBLYAI_API_KEYS"),
    "groq": _Provider(_groq_one, "GROQ_API_KEY", billed=False),
    "mistral": _Provider(_mistral_one, "MISTRAL_API_KEY", billed=False),
    "openrouter": _Provider(_openrouter_one, "OPENROUTER_API_KEY", billed=True),
    "gemini": _Provider(_gemini_one, "GEMINI_API_KEY", billed=False),
}


def hedge_enabled() -> bool:
    """Hedging is opt-in: ``VOICE_STT_HEDGE=1`` (read per call)."""
    return os.environ.get("VOICE_STT_HEDGE", "").strip().lower() in ("1", "true", "yes", "on")


def provider_order() -> list[str]:
    """Remote providers in try order: ``VOICE_STT_ORDER`` (comma list) or the pre-change production default."""
    raw = os.environ.get("VOICE_STT_ORDER", "") or DEFAULT_ORDER
    out: list[str] = []
    for name in (p.strip().lower() for p in raw.split(",")):
        if name in _PROVIDERS and name not in out:
            out.append(name)
    return out


def direct_models() -> dict[str, str]:
    """``provider -> native model id`` from the registry's ``stt_direct`` role; never raises."""
    out: dict[str, str] = {}
    try:
        from output_apps.generated_modules.smartjudge import model_registry

        ids = model_registry.role_models("stt_direct")
    except Exception:
        ids = []
    for entry in ids or _FALLBACK_DIRECT:
        provider, _, model = entry.partition(":")
        if provider and model and provider not in out:
            out[provider] = model
    for entry in _FALLBACK_DIRECT:
        provider, _, model = entry.partition(":")
        out.setdefault(provider, model)
    return out


@dataclass(frozen=True)
class _Attempt:
    provider: str
    model: str
    slot: KeySlot
    billed: bool
    call: _CallFn

    @property
    def cool_key(self) -> str:  # OpenRouter limits are per model, the others per key
        return f"{self.provider}:{self.model}" if self.provider == "openrouter" else self.provider

    @property
    def label(self) -> str:
        if self.provider == "openrouter":
            return self.model
        if self.provider == "assemblyai":
            return "assemblyai"
        return f"{self.provider}:{self.model}"


def build_attempts(api_key: str = "", assembly_keys: Optional[list[str]] = None) -> list[_Attempt]:
    """Every (provider, model, key slot) to try, in order, attempts on cooling keys last.

    Keys come from the environment (``<BASE>``, ``<BASE>_2`` .. ``_4``) plus the explicit
    ``api_key`` (OpenRouter) / ``assembly_keys`` arguments callers already pass. Unset slots are
    skipped, so a provider with no key contributes nothing.
    """
    models = direct_models()
    attempts: list[_Attempt] = []
    for name in provider_order():
        spec = _PROVIDERS[name]
        slots = env_slots(spec.key_base, list_env=spec.list_env)
        if name == "openrouter":
            slots = merge_slots([KeySlot(spec.key_base, api_key)] if api_key else [], slots)
            chain = stt_model_chain()
        else:
            chain = [models.get(name, "")] if name != "assemblyai" else ["universal"]
        if name == "assemblyai":
            slots = merge_slots(slots, [KeySlot(f"assembly_keys[{i}]", k) for i, k in enumerate(assembly_keys or [], 1)])
        for model in chain:
            if model:
                attempts.extend(_Attempt(name, model, slot, spec.billed, spec.call) for slot in slots)
    # Cooling keys go to the very end of the chain (a last resort, never dropped), so a busy or
    # revoked key does not delay every request before the healthy providers get their turn.
    healthy = [a for a in attempts if not COOLDOWNS.cooling(a.cool_key, a.slot.name)]
    return healthy + [a for a in attempts if COOLDOWNS.cooling(a.cool_key, a.slot.name)]


async def _run_attempt(client: httpx.AsyncClient, att: _Attempt, audio: bytes, ext: str, deadline: float) -> _Outcome:
    """Run one attempt, update its key's cooldown, never raise (except cancellation)."""
    if deadline - time.monotonic() < 2:
        return _Outcome(None, "budget")
    try:
        out = await att.call(client, att.slot.value, att.model, audio, ext, deadline)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        out = _Outcome(None, type(exc).__name__, transient=True)
    if out.text is not None:
        COOLDOWNS.ok(att.cool_key, att.slot.name)
    elif out.status:
        _log("STT-HTTP", f"{att.label} {att.slot.name} -> {out.why}")
        COOLDOWNS.fail(att.cool_key, att.slot.name, cooldown_for_status(out.status, out.retry_after), out.why)
    elif out.transient:
        _log("STT-FAIL", f"{att.label} {att.slot.name}: {out.why}")
        COOLDOWNS.fail(att.cool_key, att.slot.name, COOLDOWN_NETWORK_S, out.why)
    return out


async def _run_chain(
    client: httpx.AsyncClient, attempts: list[_Attempt], audio: bytes, ext: str, deadline: float, started: float
) -> tuple[Optional[SttResult], bool, str]:
    """Walk the attempts in order; hedge onto the next one when the current is slow.

    Only one attempt runs at a time, except: when nothing has answered for ``HEDGE_AFTER_S``,
    one more attempt starts alongside (at most ``MAX_IN_FLIGHT``). A hedge is never billed while
    another billed attempt is in flight, so a paid call is never doubled. The first non-empty
    text wins and the rest are cancelled.

    Returns ``(result or None, some provider answered empty, last error)``.
    """
    queue = list(attempts)
    running: dict[asyncio.Task, _Attempt] = {}
    empty_reachable = False
    last_error = ""

    def launch(index: int) -> None:
        att = queue.pop(index)
        running[asyncio.create_task(_run_attempt(client, att, audio, ext, deadline))] = att

    def hedge_index() -> Optional[int]:
        if not hedge_enabled() or len(running) >= MAX_IN_FLIGHT:
            return None
        billed_busy = any(a.billed for a in running.values())
        for i, att in enumerate(queue):
            if not (att.billed and billed_busy):
                return i
        return None

    try:
        while queue or running:
            if not running:
                if deadline - time.monotonic() < 2:
                    last_error = last_error or "budget"
                    break
                launch(0)
            left = deadline - time.monotonic()
            if left <= 0:
                last_error = last_error or "budget"
                break
            done, _ = await asyncio.wait(set(running), timeout=min(HEDGE_AFTER_S, left),
                                         return_when=asyncio.FIRST_COMPLETED)
            if not done:
                index = hedge_index()
                if index is not None and deadline - time.monotonic() >= 2:
                    _log("STT-HEDGE", f"{queue[index].label} {queue[index].slot.name}")
                    launch(index)
                continue
            for task in done:
                att = running.pop(task)
                out = task.result()
                if out.text:
                    _log("STT-OK", f"{att.label} {att.slot.name} {int((time.monotonic() - started) * 1000)}ms")
                    return SttResult(text=out.text, reachable=True, provider=att.label), True, ""
                if out.text == "":
                    # Empty answer: for a clip longer than ~1 s a flaky provider may be
                    # swallowing speech, so ask the next one before declaring silence.
                    empty_reachable = True
                    if len(audio) <= MIN_BYTES_FOR_SECOND_OPINION:
                        return SttResult(text="", reachable=True, provider=att.label), True, ""
                    last_error = f"{att.label}: empty"
                else:
                    last_error = f"{att.label}: {out.why}"
        return None, empty_reachable, last_error
    finally:
        for task in running:
            task.cancel()
        if running:
            await asyncio.gather(*running, return_exceptions=True)

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
    """Transcribe Persian speech. Never raises.

    ``api_key`` (OpenRouter) and ``assembly_keys`` are merged with the key slots found in the
    environment; see ``build_attempts``.
    """
    if not audio:
        return SttResult(error="empty")
    started = time.monotonic()
    total = budget_s if budget_s is not None else TOTAL_BUDGET_S
    deadline = started + total
    remote_deadline = started + total * REMOTE_SHARE
    last_error = ""
    empty_reachable = False

    attempts = build_attempts(api_key, assembly_keys)
    if attempts:
        try:
            async with httpx.AsyncClient() as client:
                result, empty_reachable, last_error = await _run_chain(
                    client, attempts, audio, ext, remote_deadline, started
                )
            if result is not None:
                return result
        except Exception as exc:  # defensive: transport setup errors
            last_error = f"{type(exc).__name__}"
            _log("STT-FAIL", last_error)
    else:
        last_error = "no STT key configured"

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
