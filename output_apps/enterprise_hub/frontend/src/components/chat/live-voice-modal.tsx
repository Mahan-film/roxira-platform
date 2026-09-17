"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";

export interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string;
  conversationId?: string;
  onConversationIdChange?: (id: string) => void;
  onNewMessage?: (userText: string, aiText: string, draft?: string, probability?: string) => void;
  onTriggerLegalDraft?: (type: "bill" | "petition" | "complaint" | "statement", title: string, prompt: string) => void;
}

type AudioContextCtor = typeof AudioContext;

/** Resolve the AudioContext constructor with the Safari `webkit` fallback, typed. */
function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const legacyWindow = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? legacyWindow.webkitAudioContext ?? null;
}

/**
 * The AudioContext that was created + resumed inside a real user gesture.
 * Safari only grants that context permission to make sound, so it is cached and
 * reused for TTS playback instead of being thrown away.
 */
let primedAudioContextInstance: AudioContext | null = null;

/**
 * Safari silently blocks every AudioContext until one has been created *and*
 * resumed inside a genuine user gesture — and once blocked, every later turn is
 * poisoned too (TTS chunks start life "suspended" and are simply never heard).
 *
 * Running this exact sequence in the click handler that opens the voice modal /
 * starts the call permanently removes that block for the whole page:
 *
 *   const unlockCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
 *   unlockCtx.resume();
 *   const buffer = unlockCtx.createBuffer(1, 1, 22050);
 *   const source = unlockCtx.createBufferSource();
 *   source.buffer = buffer;
 *   source.connect(unlockCtx.destination);
 *   source.start(0);
 *
 * The one-frame silent buffer is what actually flips Safari's internal
 * "has the user allowed audio?" flag; the `resume()` alone does not.
 */
export function unlockSafariAudio(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const cached = primedAudioContextInstance;
  if (cached && cached.state !== "closed") {
    if (cached.state === "suspended") cached.resume().catch(() => {});
    return cached;
  }

  try {
    // `window.AudioContext || window.webkitAudioContext` (the `any` of the
    // canonical snippet, expressed with a precise type instead).
    const legacyWindow = window as Window & { webkitAudioContext?: AudioContextCtor };
    const UnlockCtor = window.AudioContext || legacyWindow.webkitAudioContext || null;
    if (!UnlockCtor) return null;

    const unlockCtx = new UnlockCtor();
    unlockCtx.resume().catch(() => {});
    const buffer = unlockCtx.createBuffer(1, 1, 22050);
    const source = unlockCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(unlockCtx.destination);
    source.start(0);

    primedAudioContextInstance = unlockCtx;
    return unlockCtx;
  } catch (_) {
    return null;
  }
}

/** The gesture-primed context, when it is still usable (reused for playback). */
export function primedAudioContext(): AudioContext | null {
  const ctx = primedAudioContextInstance;
  return ctx && ctx.state !== "closed" ? ctx : null;
}

let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked || typeof window === "undefined") return;
  audioUnlocked = true;
  // Plays the 1-frame silent buffer inside the gesture; the context is kept
  // alive (not closed) so the playback path can inherit its permission.
  unlockSafariAudio();
}

if (typeof window !== "undefined") {
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", unlockAudioOnce, opts);
  window.addEventListener("touchstart", unlockAudioOnce, opts);
  window.addEventListener("keydown", unlockAudioOnce, opts);
}

/**
 * The transcription engine (Whisper / faster-whisper) is trained on 16 kHz mono
 * PCM16. Feeding it Safari's native 44.1/48 kHz stereo stream forces the server
 * to resample (or, worse, to interpret the wrong rate) which smears phonemes and
 * wrecks Persian accuracy. Everything we upload is therefore normalised here to
 * exactly 16 kHz / mono / PCM16 — see `resampleToTarget` + `float32ToWav`.
 */
const TARGET_SAMPLE_RATE = 16000;

/** Client-side VAD tuning (energy is a 0-100 normalised FFT level). */
const VAD_SPEECH_LEVEL = 18;
const VAD_SILENCE_LEVEL = 10;
/**
 * Silence that ends the user's turn. Persian words fade out on unstressed,
 * low-energy syllables ("...می‌شود"، "...است") and a short window chopped the
 * tail of the sentence, so the turn now only closes after 950 ms of *continuous*
 * silence (the timer is re-armed the moment speech resumes).
 */
const VAD_SILENCE_MS = 950;
const VAD_MIN_SPEECH_MS = 250;
/**
 * Self-interruption / acoustic-echo floor. While the AI is speaking the Mac
 * speakers feed our own TTS straight back into the microphone, and that bleed
 * used to look like a barge-in: playback was aborted and the turn ended with
 * "صدایی با وضوح کافی دریافت نشد". Anything at or below 0.25 of full scale
 * (25 on this 0-100 normalised level) is therefore treated as echo, ignored for
 * barge-in, and kept out of the transcription buffer entirely.
 */
const VAD_SELF_INTERRUPTION_FLOOR = 25;
/** A genuine interruption must stay above the floor this long (echo rejection). */
const VAD_BARGE_IN_HOLD_MS = 260;
/** Hard barge-in level: above the 0.25 echo floor and above speaker bleed. */
const VAD_BARGE_IN_LEVEL = 30;

/**
 * Trailing audio kept before the utterance is cut. The silence decision and the
 * last ScriptProcessor block race each other, so we wait this long (capture
 * still running) *and* append the same amount of silence to the PCM tail — the
 * final Persian syllable is then never clipped by the encoder or the STT trim.
 */
const VAD_TRAILING_PAD_MS = 100;

/** Delay before we start listening again after a failed/empty turn. */
const RESUME_LISTENING_DELAY_MS = 400;

/** Raw capture (16 kHz mono PCM) buffers the mic stream for transcription. */
const PCM_CAPTURE_BUFFER_SIZE = 4096;
const PCM_MAX_CAPTURED_SAMPLES = TARGET_SAMPLE_RATE * 30; // hard 30 s ceiling
const PCM_MIN_TURN_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.12); // < 120 ms = noise
const TTS_CHUNK_FETCH_TIMEOUT_MS = 20000;
const TTS_CHUNK_MAX_CHARS = 180;

/** Encode mono Float32 PCM (-1..1) into a 16-bit PCM WAV blob. */
export function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += bytesPerSample) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

export interface NormalizedAudioContext {
  ctx: AudioContext;
  /** Rate the context actually runs at (may differ from the requested one). */
  sampleRate: number;
  /** True when the browser honoured the preferred 16 kHz rate itself. */
  nativeTargetRate: boolean;
}

/**
 * Build an AudioContext already running at the preferred rate.
 *
 * Chrome/Firefox honour `{ sampleRate: 16000 }`, so no resampling is needed at
 * all. Safari (and any engine that ignores or rejects the option) falls back to
 * its native 44.1/48 kHz rate — `resampleToTarget` then does the conversion.
 */
export function createAudioContext(
  preferredSampleRate: number = TARGET_SAMPLE_RATE,
): NormalizedAudioContext | null {
  const AudioCtx = getAudioContextCtor();
  if (!AudioCtx) return null;

  try {
    const ctx = new AudioCtx({ sampleRate: preferredSampleRate });
    if (Math.abs(ctx.sampleRate - preferredSampleRate) < 1) {
      return { ctx, sampleRate: ctx.sampleRate, nativeTargetRate: true };
    }
    // Browser silently ignored the request — rebuild at the native rate.
    try { ctx.close(); } catch (_) {}
  } catch (_) {
    /* NotSupportedError on older Safari — fall through to the default ctor. */
  }

  try {
    const ctx = new AudioCtx();
    return {
      ctx,
      sampleRate: ctx.sampleRate,
      nativeTargetRate: Math.abs(ctx.sampleRate - preferredSampleRate) < 1,
    };
  } catch (_) {
    return null;
  }
}

/**
 * Linear-interpolation resampler: converts a mono Float32 buffer recorded at
 * `inputRate` (44.1/48 kHz on Safari) into 16 kHz mono Float32.
 *
 * A one-pole low-pass is applied first only when decimating hard (ratio > 1.5)
 * to suppress the aliasing that would otherwise fold high frequencies back into
 * the speech band as a metallic "distortion" the transcriber hates.
 */
export function resampleToTarget(
  input: Float32Array,
  inputRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (!input.length || inputRate <= 0) return new Float32Array(0);
  if (Math.abs(inputRate - targetRate) < 1) return input;

  const ratio = inputRate / targetRate;
  let source = input;

  if (ratio > 1.5) {
    // Two-pole (cascaded one-pole) anti-alias low-pass with the cutoff at
    // 0.45 × target rate (≈ 7.2 kHz for 16 kHz out). Without it, 9-24 kHz
    // content folds straight into the speech band as metallic aliasing; with a
    // steeper filter than this, Persian consonants start sounding muffled.
    const cutoff = targetRate * 0.45;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / inputRate);
    const filtered = new Float32Array(input.length);
    for (let pass = 0; pass < 2; pass++) {
      let acc = pass === 0 ? input[0] ?? 0 : filtered[0] ?? 0;
      for (let i = 0; i < input.length; i++) {
        const sample = pass === 0 ? input[i] ?? 0 : filtered[i];
        acc += alpha * (sample - acc);
        filtered[i] = acc;
      }
    }
    source = filtered;
  }

  const outLength = Math.max(1, Math.floor(source.length / ratio));
  const output = new Float32Array(outLength);
  const lastIndex = source.length - 1;

  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = source[index] ?? 0;
    const b = index >= lastIndex ? a : source[index + 1] ?? a;
    output[i] = a + (b - a) * fraction;
  }

  return output;
}

/**
 * Append `ms` of silence to a mono PCM tail so the final syllable of an
 * utterance survives both the encoder and the transcription engine's own
 * leading/trailing trim (see VAD_TRAILING_PAD_MS).
 */
export function padTrailingSilence(
  samples: Float32Array,
  sampleRate: number,
  ms: number = VAD_TRAILING_PAD_MS,
): Float32Array {
  const padLength = Math.max(0, Math.round((sampleRate * ms) / 1000));
  if (padLength === 0) return samples;
  const padded = new Float32Array(samples.length + padLength);
  padded.set(samples, 0);
  return padded;
}

/**
 * True when a VAD spike seen while the AI is speaking is loud enough to be a
 * real barge-in rather than the bot's own voice coming back out of the Mac
 * speakers. Spikes at or below the 0.25 floor are ignored (acoustic echo).
 */
export function isSelfInterruption(
  level: number,
  bargeInLevel: number = VAD_BARGE_IN_LEVEL,
): boolean {
  return level > Math.max(bargeInLevel, VAD_SELF_INTERRUPTION_FLOOR);
}

/**
 * Split a reply into speech chunks so playback can start on the FIRST sentence
 * instead of waiting for the whole synthesis job. Breaks on sentence enders
 * (`. ! ? … ؟ ؛ ;`) and on Persian commas (`,` / `،`) once a chunk is long
 * enough to sound natural, and never merges more than `TTS_CHUNK_MAX_CHARS`.
 */
export function splitIntoSpeechChunks(
  text: string,
  maxChars: number = TTS_CHUNK_MAX_CHARS,
): string[] {
  const cleaned = text.replace(/[*#_`>|]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const HARD_BREAKS = ".!?؟…؛;\n";
  const SOFT_BREAKS = "،,";
  const MIN_HARD_CHUNK = 8;
  const MIN_SOFT_CHUNK = 55;
  const MIN_EARLY_CHUNK = 40; // first chunk: start speaking ASAP

  const chunks: string[] = [];
  let buffer = "";

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    buffer += char;
    const trimmedLength = buffer.trim().length;

    const hardBreak = HARD_BREAKS.includes(char) && trimmedLength >= MIN_HARD_CHUNK;
    const softBreak = SOFT_BREAKS.includes(char) && trimmedLength >= MIN_SOFT_CHUNK;
    const earlyBreak =
      chunks.length === 0 && trimmedLength >= MIN_EARLY_CHUNK && char === " ";

    if (hardBreak || softBreak || earlyBreak || buffer.length >= maxChars) {
      const piece = buffer.trim();
      if (piece) chunks.push(piece);
      buffer = "";
    }
  }

  const tail = buffer.trim();
  if (tail) chunks.push(tail);

  return chunks;
}

export function LiveVoiceModal({
  isOpen,
  onClose,
  userPhone: externalPhone,
  conversationId: externalConvId = "",
  onConversationIdChange,
  onNewMessage,
  onTriggerLegalDraft,
}: LiveVoiceModalProps) {
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [statusText, setStatusText] = useState<string>("در حال آماده‌سازی مکالمه...");
  const [currentUserSpeech, setCurrentUserSpeech] = useState<string>("");
  const [lastAiResponse, setLastAiResponse] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;

  const isComponentOpenRef = useRef(isOpen);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** Captured 16 kHz-ready mono PCM for the current turn (see initAudioVisualizer). */
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const pcmSampleCountRef = useRef<number>(0);
  const captureSampleRateRef = useRef<number>(TARGET_SAMPLE_RATE);
  const captureNodeRef = useRef<ScriptProcessorNode | null>(null);
  const captureSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const captureSinkRef = useRef<GainNode | null>(null);
  /** Invalidates in-flight TTS chunks when the user barges in or the modal closes. */
  const speechGenerationRef = useRef<number>(0);
  const chunkResolveRef = useRef<((played: boolean) => void) | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenInThisTurnRef = useRef<boolean>(false);
  const speechStartTimeRef = useRef<number>(0);
  /** Start of a sustained above-floor spike while the AI speaks (echo guard). */
  const bargeInStartTimeRef = useRef<number>(0);
  const isSubmittingTurnRef = useRef<boolean>(false);
  const activeConversationIdRef = useRef<string>(externalConvId);

  useEffect(() => {
    isComponentOpenRef.current = isOpen;
    if (!isOpen) {
      handleEndCall();
    } else {
      // Safari: prime audio as early as possible on the open gesture.
      unlockSafariAudio();
      handleStartCall();
    }
  }, [isOpen]);

  const unlockAudio = useCallback(() => {
    // Runs the Safari silent-buffer unlock and reuses the primed context, so
    // every later TTS turn inherits the permission granted by the user gesture.
    unlockSafariAudio();
    unlockAudioOnce();
    const ctx = playbackContextRef.current ?? audioContextRef.current;
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }, []);

  /** Stop whatever is audibly playing, without invalidating the TTS queue. */
  const stopCurrentSource = useCallback(() => {
    const source = audioSourceRef.current;
    if (source) {
      try {
        source.onended = null;
        source.stop(0);
      } catch (_) {}
      try {
        source.disconnect();
      } catch (_) {}
      audioSourceRef.current = null;
    }
  }, []);

  const interruptAiSpeech = useCallback(() => {
    // Bumping the generation invalidates every queued/streaming TTS chunk so a
    // barge-in can never be followed by a stale sentence being spoken.
    speechGenerationRef.current += 1;
    const resolveChunk = chunkResolveRef.current;
    chunkResolveRef.current = null;
    if (resolveChunk) resolveChunk(false);
    stopCurrentSource();
    bargeInStartTimeRef.current = 0;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }, [stopCurrentSource]);

  // شروع ضبط قطعات صوتی
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(150); // دریافت قطعات صوتی هر ۱۵۰ میلی‌ثانیه
    } catch (err) {
      console.warn("MediaRecorder start notice:", err);
    }
  }, []);

  /** Drain the PCM captured for the current turn and reset the buffer. */
  const takeCapturedPcm = useCallback((): Float32Array => {
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    pcmSampleCountRef.current = 0;
    if (!chunks.length) return new Float32Array(0);

    let total = 0;
    for (const chunk of chunks) total += chunk.length;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }, []);

  // استخراج صوت ضبط‌شده و ارسال به سرور
  const transcribeCurrentSegment = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;

    try {
      // ── Preferred path: raw PCM captured at (or resampled to) 16 kHz mono,
      //    uploaded as a 16 kHz PCM16 WAV. No 100 ms flush delay needed.
      const captured = takeCapturedPcm();
      let audioBlob: Blob | null = null;
      let ext = "wav";

      if (captured.length >= PCM_MIN_TURN_SAMPLES) {
        // ۱۰۰ میلی‌ثانیه صدای دنباله پیش از برش: هجای پایانی کلمه فارسی حفظ می‌شود.
        const padded = padTrailingSilence(
          captured,
          captureSampleRateRef.current,
          VAD_TRAILING_PAD_MS,
        );
        const normalized = resampleToTarget(
          padded,
          captureSampleRateRef.current,
          TARGET_SAMPLE_RATE,
        );
        audioBlob = float32ToWav(normalized, TARGET_SAMPLE_RATE);
      } else if (recorder) {
        // ── Fallback: MediaRecorder (opaque AAC/Opus container).
        if (recorder.state === "recording") {
          try { recorder.requestData(); } catch (_) {}
        }
        // مکث کوتاه جهت تحویل آخرین قطعه به ondataavailable
        await new Promise((r) => setTimeout(r, 100));

        if (audioChunksRef.current.length > 0) {
          const mimeType = recorder.mimeType || "audio/mp4";
          audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          ext = /mp4|m4a|aac/i.test(mimeType)
            ? "m4a"
            : /ogg/i.test(mimeType)
            ? "ogg"
            : /wav/i.test(mimeType)
            ? "wav"
            : "webm";
        }
      }

      // آماده‌سازی نوبت بعدی در هر دو مسیر
      audioChunksRef.current = [];

      if (!audioBlob || audioBlob.size < 40) return "";

      const formData = new FormData();
      formData.append("file", audioBlob, `speech.${ext}`);

      // مهلت زمان‌بندی منطقی ۲۵ ثانیه‌ای جهت پردازش کامل صدا
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 25000);

      const res = await fetch("/api/v1/apps/judge/transcribe-audio", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      }).finally(() => clearTimeout(tId));

      if (res.ok) {
        const data = await res.json().catch(() => null);
        return (data?.text || data?.transcript || "").trim();
      }
    } catch (err) {
      console.warn("Transcribe error:", err);
    }
    return "";
  }, [takeCapturedPcm]);

  // بازگشت خودکار به نوبت شنیدن
  const resumeListening = useCallback(() => {
    if (!isComponentOpenRef.current) return;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    isSubmittingTurnRef.current = false;
    hasSpokenInThisTurnRef.current = false;
    speechStartTimeRef.current = 0;
    bargeInStartTimeRef.current = 0;
    // شروع نوبت تازه: بافر PCM نوبت قبل دور ریخته می‌شود
    pcmChunksRef.current = [];
    pcmSampleCountRef.current = 0;
    setVoiceState("listening");
    setStatusText("شنونده صحبت شما هستم؛ بفرمایید...");
    setCurrentUserSpeech("");

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      startRecording();
    }
  }, [startRecording]);

  // ── Streaming TTS: synthesise + play one sentence chunk at a time so the
  //    first words are audible long before the full answer is generated.
  const fetchTtsBlob = useCallback(async (chunk: string): Promise<Blob | null> => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TTS_CHUNK_FETCH_TIMEOUT_MS);
      const res = await fetch("/api/v1/apps/judge/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) return null;

      const contentType = res.headers.get("content-type") ?? "audio/mpeg";
      if (!res.body) return res.blob();

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          total += value.length;
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of chunks) {
        merged.set(part, offset);
        offset += part.length;
      }

      if (/pcm|l16/i.test(contentType)) {
        // Raw PCM from the TTS engine is 16 kHz mono — wrap it as a WAV so the
        // decoder never has to guess the rate.
        const frameCount = Math.floor(merged.byteLength / 2);
        const pcm = new Int16Array(merged.buffer, merged.byteOffset, frameCount);
        const floats = new Float32Array(frameCount);
        for (let i = 0; i < frameCount; i++) floats[i] = pcm[i] / 0x8000;
        return float32ToWav(floats, TARGET_SAMPLE_RATE);
      }
      return new Blob([merged], { type: contentType });
    } catch (_) {
      return null;
    }
  }, []);

  const playAiVoice = useCallback(async (text: string) => {
    if (!isComponentOpenRef.current) return;

    interruptAiSpeech();
    const generation = speechGenerationRef.current;
    setVoiceState("speaking");
    setStatusText("در حال پاسخ صوتی...");
    unlockAudio();

    const chunks = splitIntoSpeechChunks(text);
    if (!chunks.length) {
      resumeListening();
      return;
    }

    const isCurrent = () => speechGenerationRef.current === generation;

    // Watchdog is re-armed for every chunk, so a long multi-sentence answer is
    // never cut off while a single stuck chunk (silent TTS failure) still is.
    let safetyWatchdog: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = () => {
      if (safetyWatchdog) clearTimeout(safetyWatchdog);
      safetyWatchdog = setTimeout(() => {
        if (isCurrent() && voiceStateRef.current === "speaking") {
          resumeListening();
        }
      }, 18000);
    };
    const clearWatchdog = () => {
      if (safetyWatchdog) clearTimeout(safetyWatchdog);
      safetyWatchdog = null;
    };
    armWatchdog();

    const ensurePlaybackContext = (): AudioContext | null => {
      if (typeof window === "undefined") return null;
      let ctx = playbackContextRef.current;
      if (!ctx || ctx.state === "closed") {
        // Prefer the context that was already resumed inside the user gesture:
        // on Safari that is the only one with permission to make any sound.
        ctx = primedAudioContext();
        if (!ctx) {
          const AudioCtx = getAudioContextCtor();
          if (!AudioCtx) return null;
          ctx = new AudioCtx();
        }
        const gain = ctx.createGain();
        gain.gain.value = 1;
        gain.connect(ctx.destination);
        playbackContextRef.current = ctx;
        audioGainRef.current = gain;
      }
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      return ctx;
    };

    /** Play one decoded buffer and resolve when it finishes (or is cut off). */
    const playBlob = (blob: Blob): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (blob.size < 200) {
          resolve(false);
          return;
        }
        const ctx = ensurePlaybackContext();
        if (!ctx) {
          resolve(false);
          return;
        }
        const finish = (played: boolean) => {
          if (chunkResolveRef.current === finish) chunkResolveRef.current = null;
          resolve(played);
        };
        chunkResolveRef.current = finish;

        blob
          .arrayBuffer()
          .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer.slice(0)))
          .then((audioBuffer) => {
            if (!audioBuffer.length || !isCurrent()) {
              finish(false);
              return;
            }
            stopCurrentSource();
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioGainRef.current ?? ctx.destination);
            audioSourceRef.current = source;
            source.onended = () => {
              if (audioSourceRef.current === source) audioSourceRef.current = null;
              finish(true);
            };
            source.start(0);
          })
          .catch(() => finish(false));
      });

    const speakWithSpeechSynthesis = (fallbackText: string) => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
          const cleanText = fallbackText.replace(/[*#_`>]/g, " ").trim().slice(0, 160);
          const utterance = new SpeechSynthesisUtterance(cleanText);
          utterance.lang = "fa-IR";
          utterance.onend = () => resumeListening();
          utterance.onerror = () => resumeListening();
          window.speechSynthesis.speak(utterance);
          return;
        } catch (_) {}
      }
      resumeListening();
    };

    // Prefetch chunk 1 while chunk 0 is still being synthesised/played.
    let pending: Promise<Blob | null> | null = fetchTtsBlob(chunks[0]);
    let playedAny = false;
    let firstChunk = true;

    for (let i = 0; i < chunks.length; i++) {
      const blob = await pending;
      if (!isCurrent()) {
        clearWatchdog();
        return;
      }
      if (i + 1 < chunks.length) pending = fetchTtsBlob(chunks[i + 1]);

      if (!blob) {
        // A failed chunk must not kill the rest of the answer.
        if (firstChunk) break;
        continue;
      }

      if (firstChunk) {
        setStatusText("پاسخ صوتی در جریان است...");
      }
      armWatchdog();
      const played = await playBlob(blob);
      firstChunk = false;

      if (!isCurrent()) {
        clearWatchdog();
        return;
      }
      if (played) playedAny = true;
      else if (!playedAny) break; // Web Audio unusable → browser fallback
    }

    clearWatchdog();
    if (!isCurrent()) return;

    if (!playedAny) {
      speakWithSpeechSynthesis(text);
      return;
    }
    resumeListening();
  }, [
    fetchTtsBlob,
    interruptAiSpeech,
    resumeListening,
    stopCurrentSource,
    unlockAudio,
  ]);

  // پردازش کلام کاربر با هوش مصنوعی
  const processUserSpeechTurn = async (queryText: string) => {
    const text = queryText.trim();
    if (!text || text.length < 2) {
      resumeListening();
      return;
    }

    voiceStateRef.current = "thinking";
    setVoiceState("thinking");
    setStatusText("در حال تحلیل و بررسی حقوقی...");
    setCurrentUserSpeech(text);

    try {
      const res = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversation_id: activeConversationIdRef.current || undefined,
          user_phone: externalPhone,
          phone: externalPhone,
          is_vip: true,
          tier: "VIP",
          is_voice_mode: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.conversation_id) {
          activeConversationIdRef.current = data.conversation_id;
          if (onConversationIdChange) onConversationIdChange(data.conversation_id);
        }
        const reply = data.reply || data.response || "در خدمت شما هستم؛ بفرمایید چه موضوعی را بررسی کنیم؟";
        setLastAiResponse(reply);

        if (onNewMessage) {
          onNewMessage(text, reply, data.defense_draft, data.success_probability);
        }
        await playAiVoice(reply);
      } else {
        setStatusText("خطا در برقراری ارتباط؛ مجدداً بفرمایید.");
        setTimeout(() => resumeListening(), RESUME_LISTENING_DELAY_MS);
      }
    } catch (err) {
      setStatusText("ارتباط با سرور برقرار نشد.");
      setTimeout(() => resumeListening(), RESUME_LISTENING_DELAY_MS);
    }
  };

  // ارسال نوبت صحبت
  const submitSpokenTurn = useCallback(async () => {
    if (voiceStateRef.current !== "listening") return;
    if (isSubmittingTurnRef.current) return;
    isSubmittingTurnRef.current = true;

    try {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      voiceStateRef.current = "thinking";
      setVoiceState("thinking");
      setStatusText("در حال پیاده‌سازی و پردازش صدا...");

      // ۱۰۰ میلی‌ثانیه صبر می‌کنیم تا آخرین بلاک ضبط (که همچنان در جریان است)
      // برسد و صدای دنباله از دست نرود؛ سپس خودِ دنباله هم به PCM اضافه می‌شود.
      await new Promise((resolve) => setTimeout(resolve, VAD_TRAILING_PAD_MS));

      const transcript = await transcribeCurrentSegment();

      if (transcript && transcript.length >= 2) {
        setCurrentUserSpeech(transcript);
        await processUserSpeechTurn(transcript);
      } else {
        setStatusText("صدایی با وضوح کافی دریافت نشد؛ لطفاً بفرمایید...");
        setTimeout(() => resumeListening(), RESUME_LISTENING_DELAY_MS);
      }
    } finally {
      isSubmittingTurnRef.current = false;
      speechStartTimeRef.current = 0;
    }
  }, [transcribeCurrentSegment, resumeListening]);

  // راه‌اندازی سنسور و اکولایزر بدون نشت صدا به اسپیکر
  const initAudioVisualizer = (stream: MediaStream) => {
    try {
      const normalized = createAudioContext(TARGET_SAMPLE_RATE);
      if (!normalized) return;
      const audioCtx = normalized.ctx;
      audioContextRef.current = audioCtx;
      captureSampleRateRef.current = normalized.sampleRate;
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(stream);
      captureSourceRef.current = source;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser); // فقط به آنالایزر متصل است، هرگز به destination وصل نمی‌شود تا اکو رخ ندهد
      analyserRef.current = analyser;

      // ── Raw 16 kHz mono PCM16 capture ────────────────────────────────────
      // MediaRecorder hands back an opaque AAC/Opus container at the device's
      // native rate (44.1/48 kHz on Safari). Tapping the graph instead gives us
      // Float32 PCM at `normalized.sampleRate`, which the transcribe path
      // resamples to exactly 16 kHz and wraps as PCM16 WAV.
      // (ScriptProcessorNode is deprecated but is the only capture node Safari
      // supports without an AudioWorklet module download; the whole path is
      // fail-open and MediaRecorder stays as the fallback.)
      try {
        const processor = audioCtx.createScriptProcessor(PCM_CAPTURE_BUFFER_SIZE, 1, 1);
        // A ScriptProcessor only runs while connected to the destination, so we
        // route it through a muted gain — silence in, no echo out.
        const sink = audioCtx.createGain();
        sink.gain.value = 0;
        processor.connect(sink);
        sink.connect(audioCtx.destination);
        processor.onaudioprocess = (event) => {
          if (!isComponentOpenRef.current) return;
          if (pcmSampleCountRef.current >= PCM_MAX_CAPTURED_SAMPLES) return;
          const input = event.inputBuffer.getChannelData(0);
          const copy = new Float32Array(input.length);
          copy.set(input);
          pcmChunksRef.current.push(copy);
          pcmSampleCountRef.current += copy.length;
        };
        source.connect(processor);
        captureNodeRef.current = processor;
        captureSinkRef.current = sink;
      } catch (captureErr) {
        console.warn("PCM capture unavailable, falling back to MediaRecorder:", captureErr);
      }

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        if (!analyserRef.current || !streamRef.current || !isComponentOpenRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const level = Math.min(100, Math.round((sum / dataArray.length / 128) * 100));
        setAudioLevel(level);

        // VAD: پایان نوبت پس از ۹۵۰ میلی‌ثانیه سکوت + قطع فوری هنگام صحبت کاربر (barge-in)
        if (voiceStateRef.current === "listening") {
          if (level > VAD_SPEECH_LEVEL) {
            hasSpokenInThisTurnRef.current = true;
            if (!speechStartTimeRef.current) {
              speechStartTimeRef.current = Date.now();
            }
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = null;
            }
          } else if (hasSpokenInThisTurnRef.current && level < VAD_SILENCE_LEVEL) {
            const speechDuration = Date.now() - (speechStartTimeRef.current || 0);
            if (speechDuration >= VAD_MIN_SPEECH_MS && !silenceTimeoutRef.current) {
              silenceTimeoutRef.current = setTimeout(() => {
                silenceTimeoutRef.current = null;
                if (voiceStateRef.current === "listening") {
                  submitSpokenTurn();
                }
              }, VAD_SILENCE_MS);
            }
          }
        } else if (voiceStateRef.current === "speaking") {
          // ── محافظ پژواک آکوستیک (جلوگیری از خودوقفه‌ای) ────────────────────
          // اسپیکرهای مک، صدای خودِ دستیار را به میکروفون برمی‌گردانند. هر جهش
          // انرژی در محدوده ۰.۲۵ و پایین‌تر (۲۵ از ۱۰۰) پژواک است: نه به‌عنوان
          // وقفه کاربر پذیرفته می‌شود و نه اجازه دارد به موتور تبدیل گفتار برسد
          // (همان مسیری که با «صدایی با وضوح کافی دریافت نشد» پخش را قطع می‌کرد).
          if (isSelfInterruption(level)) {
            if (!bargeInStartTimeRef.current) {
              bargeInStartTimeRef.current = Date.now();
            }
            if (Date.now() - bargeInStartTimeRef.current >= VAD_BARGE_IN_HOLD_MS) {
              // کاربر صحبت را قطع می‌کند: پخش پاسخ بلافاصله متوقف و به حالت شنیدن برمی‌گردیم.
              bargeInStartTimeRef.current = 0;
              interruptAiSpeech();
              hasSpokenInThisTurnRef.current = true;
              speechStartTimeRef.current = Date.now();
              resumeListening();
            }
          } else {
            // زیر آستانه: فقط صدای خودمان در میکروفون است؛ بافر تبدیل گفتار دور ریخته می‌شود.
            bargeInStartTimeRef.current = 0;
            pcmChunksRef.current = [];
            pcmSampleCountRef.current = 0;
          }
        }

        animFrameRef.current = requestAnimationFrame(loop);
      };

      loop();
    } catch (e) {
      console.warn("Audio visualizer notice:", e);
    }
  };

  // شروع مکالمه
  const handleStartCall = async () => {
    unlockAudio();
    interruptAiSpeech();
    setCurrentUserSpeech("");
    setLastAiResponse("");
    hasSpokenInThisTurnRef.current = false;
    speechStartTimeRef.current = 0;
    setVoiceState("listening");
    setStatusText("در حال اتصال به میکروفون...");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("میکروفون در دسترس نیست.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // سه خواسته سخت و غیرقابل‌مذاکره: بدون آن‌ها صدای اسپیکر به میکروفون
          // برمی‌گردد و دستیار پاسخ خودش را قطع می‌کند.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Best-effort request for 16 kHz mono from the device itself; engines
          // that ignore it are handled by createAudioContext + resampleToTarget.
          sampleRate: { ideal: TARGET_SAMPLE_RATE },
          channelCount: { ideal: 1 },
        },
      });
      streamRef.current = stream;

      pcmChunksRef.current = [];
      pcmSampleCountRef.current = 0;
      initAudioVisualizer(stream);
      startRecording();
      setStatusText("شنونده صحبت شما هستم؛ بفرمایید...");
    } catch (err) {
      console.error("Mic error:", err);
      setVoiceState("idle");
      setStatusText("دسترسی به میکروفون مجاز نیست. لطفاً دسترسی را فعال کنید.");
    }
  };

  // اتمام مکالمه
  const handleEndCall = () => {
    interruptAiSpeech();
    setVoiceState("idle");
    setStatusText("مکالمه به پایان رسید.");
    setAudioLevel(0);
    speechStartTimeRef.current = 0;
    bargeInStartTimeRef.current = 0;

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    isSubmittingTurnRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try { audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }
    if (captureNodeRef.current) {
      try { captureNodeRef.current.onaudioprocess = null; captureNodeRef.current.disconnect(); } catch (_) {}
      captureNodeRef.current = null;
    }
    if (captureSinkRef.current) {
      try { captureSinkRef.current.disconnect(); } catch (_) {}
      captureSinkRef.current = null;
    }
    if (captureSourceRef.current) {
      try { captureSourceRef.current.disconnect(); } catch (_) {}
      captureSourceRef.current = null;
    }
    pcmChunksRef.current = [];
    pcmSampleCountRef.current = 0;
    analyserRef.current = null;
    if (audioSourceRef.current) {
      try { audioSourceRef.current.onended = null; audioSourceRef.current.stop(0); } catch (_) {}
      audioSourceRef.current = null;
    }
    if (playbackContextRef.current && playbackContextRef.current.state !== "closed") {
      try { playbackContextRef.current.close(); } catch (_) {}
      playbackContextRef.current = null;
      audioGainRef.current = null;
    }
  };

  const toggleMute = () => {
    if (!streamRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    streamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted;
    });
    setStatusText(newMuted ? "میکروفون موقتاً قطع شد." : "میکروفون متصل شد؛ بفرمایید...");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-2xl animate-in fade-in duration-200" dir="rtl">
      <div className="bg-slate-950/95 border border-slate-800/90 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl relative text-center text-slate-100 flex flex-col justify-between max-h-[88vh] overflow-y-auto ring-1 ring-white/10">
        
        {/* هدر مینیمال و پاکیزه */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${
              voiceState === "speaking" ? "bg-purple-400 animate-ping" :
              voiceState === "thinking" ? "bg-amber-400 animate-spin" :
              voiceState === "listening" ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
            }`} />
            <span className="text-xs font-semibold text-slate-200">گفتگوی صوتی زنده</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors"
            title="بستن مکالمه"
          >
            ✕
          </button>
        </div>

        {/* گوی تعاملی و مدرن */}
        <div className="my-6 flex flex-col items-center justify-center space-y-4">
          <div className="relative flex items-center justify-center w-40 h-40 sm:w-48 sm:h-48">
            {/* هاله امواج صوتی */}
            <div
              className={`absolute rounded-full transition-all duration-100 blur-xl pointer-events-none ${
                voiceState === "speaking"
                  ? "bg-purple-600/30"
                  : voiceState === "thinking"
                  ? "bg-amber-500/25"
                  : "bg-emerald-500/20"
              }`}
              style={{
                width: `${120 + audioLevel * 1.4}px`,
                height: `${120 + audioLevel * 1.4}px`,
              }}
            />

            {/* گوی لمسی */}
            <button
              onClick={() => {
                unlockAudio();
                if (voiceState === "listening") {
                  submitSpokenTurn();
                } else if (voiceState === "speaking") {
                  interruptAiSpeech();
                } else {
                  resumeListening();
                }
              }}
              className={`relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center shadow-2xl transition-all duration-150 cursor-pointer active:scale-95 ${
                voiceState === "speaking"
                  ? "bg-gradient-to-tr from-purple-600 via-indigo-500 to-pink-500 shadow-purple-500/50 ring-4 ring-purple-400/30"
                  : voiceState === "thinking"
                  ? "bg-gradient-to-tr from-amber-500 via-yellow-500 to-orange-500 animate-pulse shadow-amber-500/50 ring-4 ring-amber-400/30"
                  : voiceState === "listening"
                  ? "bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 shadow-emerald-500/40 ring-4 ring-emerald-400/30 hover:scale-105"
                  : "bg-slate-800 ring-1 ring-slate-700"
              }`}
              style={{
                transform: `scale(${1 + (audioLevel / 220)})`,
              }}
              title={voiceState === "listening" ? "لمس برای ارسال پاسخ" : "لمس برای توقف یا شروع مجدد"}
            >
              <span className="text-2xl sm:text-3xl filter drop-shadow">
                {voiceState === "speaking" ? "🔊" :
                 voiceState === "thinking" ? "⏳" :
                 voiceState === "listening" ? "🎙️" : "📞"}
              </span>
            </button>
          </div>

          {/* اکولایزر فرکانسی مینیمال */}
          <div className="flex items-center justify-center gap-1.5 h-6 w-full max-w-[200px] mx-auto">
            {[0.4, 0.8, 1.3, 1.8, 1.4, 0.9, 1.5, 0.7, 1.1, 0.5].map((factor, idx) => {
              const barHeight = voiceState === "listening"
                ? Math.max(3, Math.min(22, (audioLevel * factor * 0.6)))
                : voiceState === "speaking"
                ? Math.max(4, Math.sin(Date.now() / 200 + idx) * 8 + 10)
                : 3;
              return (
                <div
                  key={idx}
                  className={`w-1 rounded-full transition-all duration-75 ${
                    voiceState === "speaking"
                      ? "bg-purple-400 shadow-[0_0_6px_rgba(192,132,252,0.5)]"
                      : voiceState === "listening"
                      ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]"
                      : "bg-slate-800"
                  }`}
                  style={{ height: `${barHeight}px` }}
                />
              );
            })}
          </div>

          {/* وضعیت لحظه‌ای سیستم */}
          <div className="space-y-2.5 max-w-sm mx-auto w-full px-1">
            <p className="text-xs sm:text-sm font-medium text-slate-300 min-h-[22px]">
              {statusText}
            </p>

            {/* دکمه ارسال نوبت کلام با خیال راحت */}
            {voiceState === "listening" && (
              <button
                onClick={() => {
                  unlockAudio();
                  submitSpokenTurn();
                }}
                className="w-full py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-slate-950 font-bold rounded-xl text-xs sm:text-sm shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <span>🎙️</span>
                <span>پایان کلام و ارسال</span>
                <span>➤</span>
              </button>
            )}

            {/* متن گفته‌شده توسط کاربر */}
            {currentUserSpeech && (
              <div className="bg-slate-900/90 border border-slate-800 p-2.5 rounded-xl text-xs text-slate-200 text-right">
                <span className="text-cyan-400 font-bold ml-1">شما:</span>
                <span>{currentUserSpeech}</span>
              </div>
            )}

            {/* پاسخ دستیار صوتی */}
            {lastAiResponse && (
              <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-xl text-right text-xs text-slate-100 max-h-48 overflow-y-auto leading-relaxed border-r-2 border-r-purple-500">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-purple-400 font-bold text-xs">پاسخ:</span>
                  <button
                    onClick={() => playAiVoice(lastAiResponse)}
                    className="text-[10px] text-slate-400 hover:text-purple-300 px-2 py-0.5 rounded bg-slate-800 transition-colors"
                  >
                    🔊 پخش مجدد
                  </button>
                </div>
                <p className="whitespace-pre-line leading-relaxed">{lastAiResponse}</p>
              </div>
            )}
          </div>
        </div>

        {/* دکمه‌های کنترل مینیمال در پایین */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
          <button
            onClick={() => {
              unlockAudio();
              toggleMute();
            }}
            className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
              isMuted
                ? "bg-rose-500/20 border-rose-500/50 text-rose-300"
                : "bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300"
            }`}
          >
            <span>{isMuted ? "🔇 وصل میکروفون" : "🎙️ قطع میکروفون"}</span>
          </button>

          <button
            onClick={() => {
              handleEndCall();
              onClose();
            }}
            className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
          >
            <span>💬 ادامه در چت</span>
          </button>

          <button
            onClick={handleEndCall}
            className="px-4 py-2 bg-rose-600/90 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1"
            title="پایان تماس"
          >
            <span>✕ قطع تماس</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default LiveVoiceModal;
