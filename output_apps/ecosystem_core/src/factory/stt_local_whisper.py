import io
import os


_MODEL = None


def _load_model():
    global _MODEL
    if _MODEL is None:
        from faster_whisper import WhisperModel

        _MODEL = WhisperModel(
            os.environ.get("ROXIRA_STT_LOCAL_MODEL", "large-v3-turbo"),
            device="cpu",
            compute_type="int8",
        )
    return _MODEL


def transcribe_local(
    wav_bytes: bytes, prompt: str, model=None
) -> tuple[str, float | None]:
    m = model or _load_model()
    segments, _info = m.transcribe(
        io.BytesIO(wav_bytes),
        language="fa",
        task="transcribe",
        temperature=0,
        initial_prompt=prompt,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 700, "speech_pad_ms": 250},
    )
    segs = list(segments)
    return (
        " ".join(s.text.strip() for s in segs).strip(),
        min(s.avg_logprob for s in segs) if segs else None,
    )


def is_confident(text: str, min_logprob: float | None) -> bool:
    return bool(text) and (min_logprob is None or min_logprob >= -1.0)
