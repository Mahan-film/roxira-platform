"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";

export interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string;
  conversationId?: string;
  onConversationIdChange?: (id: string) => void;
  onNewMessage?: (userText: string, aiText: string, draft?: string, probability?: string) => void;
}

// ── آنلاک سیاست پخش خودکار Safari و Chrome ──────────────────────────────────────────
let audioUnlocked = false;

function unlockAudioOnce() {
  if (audioUnlocked || typeof window === "undefined") return;
  audioUnlocked = true;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      if (typeof source.start === "function") source.start(0);
      if (ctx.state === "suspended") {
        const r = ctx.resume();
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
      }
      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
      }, 400);
    }
  } catch (_) {}

  try {
    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
    );
    silent.muted = true;
    const p = silent.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {}
}

if (typeof window !== "undefined") {
  const unlockOpts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", unlockAudioOnce, unlockOpts);
  window.addEventListener("touchstart", unlockAudioOnce, unlockOpts);
  window.addEventListener("keydown", unlockAudioOnce, unlockOpts);
}

// تابع ترمیم آوایی کلمات قضایی در فرانت‌اند
const repairPhoneticsClient = (raw: string): string => {
  if (!raw) return "";
  let t = raw;
  t = t.replace(/(?:آخرت|آخرین|اخرین)\s*(?:آرائه|ارائه|ارای|آرای)?\s*(?:وقت\s*ویدیو|وقتت\s*رویه|وقتترابی|وقت\s*رویه)/gi, "آخرین رأی وحدت رویه");
  t = t.replace(/از\s*ملورا\s*ملورا\s*دی/gi, "آخرین رأی وحدت رویه دیوان");
  t = t.replace(/ملورا\s*دی/gi, "وحدت رویه دیوان");
  t = t.replace(/وقت\s*ویدیو/gi, "وحدت رویه");
  t = t.replace(/وقتت\s*رویه/gi, "وحدت رویه");
  t = t.replace(/وقتترابی/gi, "وحدت رویه");
  t = t.replace(/رئیم\s*باحتت/gi, "رأی وحدت رویه");
  t = t.replace(/دادگاه\s*صلحا/gi, "دادگاه صلح");
  t = t.replace(/قوبه\s*قضایی/gi, "قوه قضاییه");
  t = t.replace(/اعاده\s*داد\s*رسی/gi, "اعاده دادرسی");
  t = t.replace(/تاخیر\s*تادیه/gi, "تأخیر تأدیه");
  return t;
};

export function LiveVoiceModal({
  isOpen,
  onClose,
  userPhone: externalPhone,
  conversationId: externalConvId = "",
  onConversationIdChange,
  onNewMessage,
}: LiveVoiceModalProps) {
  const { user } = useAuth();
  const userPhone = user?.phone || "09129367796";

  // وضعیت‌های چرخه مکالمه
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [statusText, setStatusText] = useState("در حال راه‌اندازی...");
  const [currentUserSpeech, setCurrentUserSpeech] = useState("");
  const [lastAiResponse, setLastAiResponse] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // مراجع نوبت و رسانه
  const voiceStateRef = useRef(voiceState);
  const isMutedRef = useRef(isMuted);
  const isComponentOpenRef = useRef(isOpen);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const isSubmittingTurnRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const activeConversationIdRef = useRef<string>("");
  const autoSubmitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // متغیرهای مدیریت سکوت و تشخیص کلام
  const accumulatedSpeechRef = useRef<string>("");
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenInThisTurnRef = useRef<boolean>(false);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isComponentOpenRef.current = isOpen;
    if (!isOpen) {
      handleEndCall();
    } else {
      handleStartCall();
    }
  }, [isOpen]);

  const unlockAudio = useCallback(() => {
    unlockAudioOnce();
  }, []);

  // متوقف کردن بلادرنگ صدای هوش مصنوعی در صورت ورود کاربر (Barge-in)
  const interruptAiSpeech = useCallback(() => {
    if (currentAudioElementRef.current) {
      try {
        currentAudioElementRef.current.pause();
        currentAudioElementRef.current.currentTime = 0;
      } catch (_) {}
      currentAudioElementRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }, []);

  // شروع قطعه ضبط صوتی برای فالبک سرور
  const startRecordingSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      try { recorder.start(250); } catch (_) { recorder.start(); }
    } catch (e) {
      console.warn("Recorder start notice:", e);
    }
  }, []);

  // تبدیل صوت به متن با اولویت موتورهای با دقت بالای سرور (Faster-Whisper / Gemini Flash Multimodal)
  const transcribeCurrentSegment = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    let serverText = "";

    if (recorder && recorder.state !== "inactive") {
      try {
        const blob = await new Promise<Blob>((resolve) => {
          const timeoutId = setTimeout(() => {
            const type = recorder.mimeType || audioChunksRef.current[0]?.type || "audio/mp4";
            resolve(new Blob(audioChunksRef.current, { type }));
          }, 600);
          recorder.onstop = () => {
            clearTimeout(timeoutId);
            const type = recorder.mimeType || audioChunksRef.current[0]?.type || "audio/mp4";
            resolve(new Blob(audioChunksRef.current, { type }));
          };
          try { recorder.stop(); } catch (_) {
            clearTimeout(timeoutId);
            resolve(new Blob([], { type: "audio/mp4" }));
          }
        });
        audioChunksRef.current = [];
        mediaRecorderRef.current = null;

        if (blob && blob.size > 400) {
          const ext = /mp4|m4a|aac/i.test(blob.type)
            ? "m4a"
            : /ogg/i.test(blob.type)
            ? "ogg"
            : /wav/i.test(blob.type)
            ? "wav"
            : "webm";
          const formData = new FormData();
          formData.append("file", blob, `speech.${ext}`);

          const controller = new AbortController();
          const tId = setTimeout(() => controller.abort(), 4500);
          const res = await fetch("/api/v1/apps/judge/transcribe-audio", {
            method: "POST",
            body: formData,
            signal: controller.signal,
          }).finally(() => clearTimeout(tId));

          if (res.ok) {
            const data = await res.json().catch(() => null);
            serverText = (data?.text || data?.transcript || "").trim();
          }
        }
      } catch (e) {
        console.warn("Server STT error, falling back to local:", e);
      }
    }

    if (serverText && serverText.length >= 2) {
      return repairPhoneticsClient(serverText);
    }

    return repairPhoneticsClient(accumulatedSpeechRef.current.trim());
  }, []);

  // بازگشت خودکار به وضعیت شنیدن برای نوبت بعدی مکالمه بدون دخالت کاربر
  const resumeListening = useCallback(() => {
    if (!isComponentOpenRef.current) return;
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    isSubmittingTurnRef.current = false;
    setVoiceState("listening");
    setStatusText("بفرمایید، شنونده صحبت شما هستم...");
    accumulatedSpeechRef.current = "";
    setCurrentUserSpeech("");
    hasSpokenInThisTurnRef.current = false;

    // شروع مجدد ضبط برای قطعه جدید
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      startRecordingSegment();
    }

    // ریست تمیز Web Speech Recognition برای نوبت جدید
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      setTimeout(() => {
        if (voiceStateRef.current === "listening" && isComponentOpenRef.current && recognitionRef.current) {
          try { recognitionRef.current.start(); } catch (_) {}
        }
      }, 150);
    }
  }, [startRecordingSegment]);

  // فالبک مرورگر در صورت عدم امکان پخش مستقیم
  const fallbackBrowserTts = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resumeListening();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*#_`>]/g, "").split("\n")[0].trim().slice(0, 180);
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = "fa-IR";
      utterance.rate = 1.0;
      utterance.volume = 1;
      utterance.onstart = () => {
        setVoiceState("speaking");
        setStatusText("در حال پاسخ...");
      };
      utterance.onend = () => resumeListening();
      utterance.onerror = () => resumeListening();
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      resumeListening();
    }
  }, [resumeListening]);

  // پخش پاسخ صوتی هوش مصنوعی و اتصال خودکار به نوبت بعدی شنیدن
  const playAiVoice = useCallback(async (text: string) => {
    if (!isComponentOpenRef.current) return;

    interruptAiSpeech();
    setVoiceState("speaking");
    setStatusText("پاسخ قاضی هوشمند (در حال پخش...)");
    unlockAudio();

    let played = false;

    // زمان‌سنج نجات اضطراری: در صورت عدم اتمام صوت به هر دلیل، سشن شنیدن قطع نمی‌شود
    const safetyWatchdog = setTimeout(() => {
      if (voiceStateRef.current === "speaking") {
        console.warn("Safety auto-resume to listening after playback timeout");
        resumeListening();
      }
    }, 14000);

    const playAudioStream = async (url: string): Promise<boolean> => {
      try {
        const audio = new Audio(url);
        audio.preload = "auto";
        currentAudioElementRef.current = audio;

        audio.onended = () => {
          clearTimeout(safetyWatchdog);
          if (currentAudioElementRef.current === audio) currentAudioElementRef.current = null;
          resumeListening();
        };

        audio.onerror = () => {
          clearTimeout(safetyWatchdog);
          if (currentAudioElementRef.current === audio) currentAudioElementRef.current = null;
          resumeListening();
        };

        audio.playbackRate = 1.15;
        await audio.play();
        return true;
      } catch (e) {
        console.warn("Audio stream play notice:", e);
        return false;
      }
    };

    // استراتژی ۱: اندپوینت استریم TTS فارسی اختصاصی سرور (Microsoft Neural Farid/Dilara)
    try {
      const response = await fetch("/api/v1/apps/judge/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 350) }),
      });

      const isAudio =
        response.ok &&
        (response.headers.get("content-type") || "").toLowerCase().includes("audio");

      if (isAudio) {
        const audioBlob = await response.blob();
        if (audioBlob.size > 200) {
          const blobUrl = URL.createObjectURL(audioBlob);
          const ok = await playAudioStream(blobUrl);
          if (ok) {
            played = true;
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Server TTS fetch error:", e);
    }

    // استراتژی ۲: فالبک مرورگر
    if (!played) {
      fallbackBrowserTts(text);
      // تایمر جهت بازگشت به نوبت شنیدن پس از مطالعه پیام
      setTimeout(() => {
        clearTimeout(safetyWatchdog);
        if (voiceStateRef.current === "speaking") {
          resumeListening();
        }
      }, 4000);
    }
  }, [interruptAiSpeech, resumeListening, unlockAudio, fallbackBrowserTts]);

  // ارسال پرسش به هوش مصنوعی و دریافت پاسخ استدلالی
  const processUserSpeechTurn = async (queryText: string) => {
    const text = (queryText || accumulatedSpeechRef.current).trim();
    
    // فیلتر هوشمند صداهای پس‌زمینه، تنفس و نویزهای کوتاه تصادفی میکروفون (آه، اوه، پف، هوم...)
    const fillerSet = new Set(["آه", "او", "ام", "اِ", "پف", "هوم", "اه", "خب", "ها", "ای", "عه", "اوه", "هم", "umm", "uh", "ah"]);
    if (!text || text.length < 3 || fillerSet.has(text.toLowerCase())) {
      console.log("Ignored background filler sound:", text);
      resumeListening();
      return;
    }

    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }

    voiceStateRef.current = "thinking";
    setVoiceState("thinking");
    setStatusText("در حال تحلیل ادله و مستندات قانونی...");
    setCurrentUserSpeech(text);
    accumulatedSpeechRef.current = "";
    hasSpokenInThisTurnRef.current = false;

    try {
      const res = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversation_id: activeConversationIdRef.current || undefined,
          user_phone: userPhone,
          phone: userPhone,
          is_vip: true,
          tier: "VIP",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.conversation_id) {
          activeConversationIdRef.current = data.conversation_id;
          if (onConversationIdChange) onConversationIdChange(data.conversation_id);
        }
        const reply = data.reply || data.response || "موضوع شما بر مبنای قوانین و رویه قضایی جاری بررسی شد.";
        setLastAiResponse(reply);

        // همگام‌سازی بی‌درنگ گفتگو با صفحه اصلی چت (تنظیم لایحه و مشاهده متنی)
        if (onNewMessage) {
          onNewMessage(text, reply, data.defense_draft, data.success_probability);
        }
        await playAiVoice(reply);
      } else {
        setStatusText("خطا در دریافت پاسخ؛ لطفاً دوباره تلاش کنید.");
        setTimeout(() => resumeListening(), 2000);
      }
    } catch (err) {
      console.error("AI consult error:", err);
      setStatusText("ارتباط با سرور برقرار نشد.");
      setTimeout(() => resumeListening(), 2000);
    }
  };

  // ارسال خودکار یا دستی نوبت مکالمه
  const submitSpokenTurn = useCallback(async () => {
    if (voiceStateRef.current !== "listening") return;
    if (isSubmittingTurnRef.current) return;
    isSubmittingTurnRef.current = true;

    try {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      voiceStateRef.current = "thinking";
      setVoiceState("thinking");
      setStatusText("در حال پردازش گفتار شما...");

      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }

      // استخراج و ترمیم فوری کلام گفته‌شده با اعمال فیلتر آوایی حقوقی
      let rawText = accumulatedSpeechRef.current.trim();
      let transcript = repairPhoneticsClient(rawText);

      // در صورتی که متن مرورگر خالی باشد، بلافاصله از موتور صوتی سرور واکشی کن
      if (!transcript || transcript.length < 2) {
        setStatusText("در حال استخراج صوتی با هوش مصنوعی...");
        const serverTrans = await transcribeCurrentSegment();
        if (serverTrans) {
          transcript = repairPhoneticsClient(serverTrans);
        }
      }

      if (transcript && transcript.length >= 2) {
        setCurrentUserSpeech(transcript);
        await processUserSpeechTurn(transcript);
      } else {
        setStatusText("صدایی تشخیص داده نشد؛ بفرمایید صحبت کنید...");
        setTimeout(() => resumeListening(), 1500);
      }
    } finally {
      isSubmittingTurnRef.current = false;
    }
  }, [transcribeCurrentSegment, resumeListening]);

  // مانیتورینگ صوتی، شدت سیگنال و انیمیشن گوی
  const initAudioVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        const r = audioCtx.resume();
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

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

        // مانیتورینگ بصری شدت صدا (بدون قطع خودکار وسط کلام قاضی هوشمند تا از اکوی اسپیکر جلوگیری شود)
        // کاربر در صورت تمایل به قطع کلام می‌تواند دکمه ✋ قطع صحبت را فشار دهد.

        // فالبک سکوت برای ارسال خودکار صوتی (VAD)
        if (voiceStateRef.current === "listening") {
          if (level > 18) {
            hasSpokenInThisTurnRef.current = true;
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = null;
            }
          } else if (hasSpokenInThisTurnRef.current && level < 14) {
            if (!silenceTimeoutRef.current) {
              silenceTimeoutRef.current = setTimeout(() => {
                silenceTimeoutRef.current = null;
                if (voiceStateRef.current === "listening") {
                  submitSpokenTurn();
                }
              }, 1400);
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(loop);
      };

      loop();
    } catch (e) {
      console.warn("Audio visualizer init error:", e);
    }
  };

  // راه‌اندازی اولیه مکالمه
  const handleStartCall = async () => {
    unlockAudio();
    interruptAiSpeech();
    setCurrentUserSpeech("");
    setLastAiResponse("");
    accumulatedSpeechRef.current = "";
    hasSpokenInThisTurnRef.current = false;
    setVoiceState("listening");
    setStatusText("در حال آماده‌سازی میکروفون...");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("مرورگر از دسترسی میکروفون پشتیبانی نمی‌کند.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      initAudioVisualizer(stream);
      startRecordingSegment();

      // اتصال موتور تشخیص گفتار پیشرفته فارسی (Web Speech Recognition)
      try {
        const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRec) {
          const rec = new SpeechRec();
          rec.lang = "fa-IR";
          rec.continuous = true;
          rec.interimResults = true;
          rec.maxAlternatives = 1;

          rec.onresult = (event: any) => {
            let fullTranscript = "";
            for (let i = 0; i < event.results.length; ++i) {
              fullTranscript += event.results[i][0].transcript + " ";
            }
            fullTranscript = fullTranscript.trim();
            if (fullTranscript) {
              const cleaned = repairPhoneticsClient(fullTranscript);
              accumulatedSpeechRef.current = cleaned;
              setCurrentUserSpeech(cleaned);
              hasSpokenInThisTurnRef.current = true;

              // تشخیص پایان طبیعی کلام: پس از ۱.۲ ثانیه مکث، پاسخ به صورت خودکار ارسال می‌شود
              if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
              autoSubmitTimerRef.current = setTimeout(() => {
                if (voiceStateRef.current === "listening" && accumulatedSpeechRef.current.trim().length >= 2) {
                  submitSpokenTurn();
                }
              }, 1000);
            }
          };

// مکث طبیعی: اجازه صحبت پیوسته به کاربر بدون قطع کردن کلام

          rec.onerror = (err: any) => console.warn("SpeechRec notice:", err);
          rec.onend = () => {
            if (voiceStateRef.current === "listening" && isComponentOpenRef.current) {
              try { rec.start(); } catch (_) {}
            }
          };

          rec.start();
          recognitionRef.current = rec;
        }
      } catch (err) {
        console.warn("Web Speech API init notice:", err);
      }

      setStatusText("بفرمایید، شنونده صحبت شما هستم...");
    } catch (err: any) {
      console.error("Microphone access error:", err);
      setVoiceState("idle");
      setStatusText("دسترسی به میکروفون داده نشد؛ لطفاً در تنظیمات مرورگر اجازه دهید.");
    }
  };

  // پایان تماس و پاکسازی
  const handleEndCall = () => {
    interruptAiSpeech();
    setVoiceState("idle");
    setStatusText("مکالمه پایان یافت.");
    setAudioLevel(0);
    accumulatedSpeechRef.current = "";

    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }
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
  };

  const toggleMute = () => {
    if (!streamRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    streamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted;
    });
    if (newMuted) {
      setStatusText("میکروفون قطع شد.");
    } else {
      setStatusText("میکروفون وصل شد؛ بفرمایید...");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-2xl animate-in fade-in duration-300" dir="rtl">
      <div className="bg-gradient-to-b from-slate-900 via-slate-950 to-black border border-slate-800/80 rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative text-center text-slate-100 flex flex-col justify-between max-h-[92vh] overflow-y-auto ring-1 ring-cyan-500/20">
        
        {/* دکمه بستن در گوشه بالا */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors"
          title="بستن مکالمه"
        >
          ✕
        </button>

        {/* برچسب وضعیت زنده */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="px-4 py-1.5 bg-gradient-to-r from-cyan-500/10 via-emerald-500/10 to-purple-500/10 border border-cyan-500/30 text-cyan-300 text-xs rounded-full font-medium flex items-center gap-2 shadow-sm">
            <span className={`w-2 h-2 rounded-full ${
              voiceState === "speaking" ? "bg-purple-400 animate-ping" :
              voiceState === "thinking" ? "bg-amber-400 animate-spin" :
              voiceState === "listening" ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
            }`} />
            <span>مکالمه زنده هوشمند (Real-Time Auto Talk)</span>
          </span>
        </div>

        {/* گوی تعاملی هوش مصنوعی */}
        <div className="my-8 flex flex-col items-center justify-center space-y-6">
          <div className="relative flex items-center justify-center w-48 h-48 sm:w-56 sm:h-56">
            
            {/* هاله امواج صوتی خارجی */}
            <div
              className={`absolute rounded-full transition-all duration-100 blur-xl pointer-events-none ${
                voiceState === "speaking"
                  ? "bg-purple-600/35"
                  : voiceState === "thinking"
                  ? "bg-amber-500/30"
                  : "bg-emerald-500/25"
              }`}
              style={{
                width: `${140 + audioLevel * 1.6}px`,
                height: `${140 + audioLevel * 1.6}px`,
              }}
            />

            {/* حلقه تنفس نورانی */}
            <div
              className={`absolute rounded-full border-2 transition-all duration-150 pointer-events-none ${
                voiceState === "speaking"
                  ? "border-purple-400/60 shadow-[0_0_50px_rgba(168,85,247,0.5)] animate-pulse"
                  : voiceState === "thinking"
                  ? "border-amber-400/60 shadow-[0_0_50px_rgba(251,191,36,0.5)] animate-spin"
                  : "border-emerald-400/50 shadow-[0_0_40px_rgba(52,211,153,0.4)]"
              }`}
              style={{
                width: `${120 + audioLevel * 1.2}px`,
                height: `${120 + audioLevel * 1.2}px`,
              }}
            />

            {/* گوی اصلی هوش مصنوعی */}
            <div
              className={`relative z-10 w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center shadow-2xl transition-transform duration-100 ${
                voiceState === "speaking"
                  ? "bg-gradient-to-tr from-purple-600 via-indigo-500 to-pink-500 scale-105 shadow-purple-500/50"
                  : voiceState === "thinking"
                  ? "bg-gradient-to-tr from-amber-500 via-yellow-500 to-orange-500 scale-95 animate-pulse shadow-amber-500/50"
                  : voiceState === "listening"
                  ? "bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 scale-100 shadow-emerald-500/40"
                  : "bg-slate-800"
              }`}
              style={{
                transform: `scale(${1 + (audioLevel / 200)})`,
              }}
            >
              <span className="text-3xl sm:text-4xl filter drop-shadow">
                {voiceState === "speaking" ? "🔊" :
                 voiceState === "thinking" ? "⚖️" :
                 voiceState === "listening" ? "🎙️" : "📞"}
              </span>
            </div>
          </div>

          {/* وضعیت لحظه‌ای سیستم */}
          <div className="space-y-3 max-w-md mx-auto w-full px-2">
            <p className="text-xs sm:text-sm font-semibold text-slate-200 min-h-[24px]">
              {statusText}
            </p>

            {/* نشانگر ریل‌تایم خودکار */}
            {voiceState === "listening" && (
              <p className="text-[11px] text-emerald-400/80 animate-pulse font-medium">
                💡 کافیست صحبت کنید؛ پس از اتمام کلام، سامانه خودکار پاسخ می‌دهد.
              </p>
            )}

            {/* کلام کاربر به صورت لحظه‌ای */}
            {currentUserSpeech && (
              <div className="bg-slate-950/80 border border-slate-800/90 p-3 rounded-2xl text-xs text-slate-300 text-right shadow-inner animate-in fade-in">
                <span className="text-cyan-400 font-bold ml-1.5">شما:</span>
                <span>{currentUserSpeech}</span>
              </div>
            )}

            {/* پاسخ تحلیلی قاضی هوشمند */}
            {lastAiResponse && (
              <div className="bg-slate-950/95 border border-purple-500/20 p-4 rounded-2xl text-right text-xs text-slate-100 max-h-60 overflow-y-auto leading-relaxed border-r-4 border-r-purple-500 shadow-2xl shadow-purple-950/30 animate-in fade-in transition-all scrollbar-thin scrollbar-thumb-purple-900/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-purple-400 font-bold text-xs">⚖️ پاسخ قاضی هوشمند:</span>
                  <button
                    onClick={() => playAiVoice(lastAiResponse)}
                    className="text-[10px] text-slate-400 hover:text-purple-300 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 transition-colors"
                  >
                    🔊 بازپخش صوتی
                  </button>
                </div>
                <p className="whitespace-pre-line leading-relaxed">{lastAiResponse}</p>
              </div>
            )}
          </div>

          {/* موضوعات سریع */}
          <div className="flex flex-wrap justify-center gap-1.5 pt-2">
            {[
              "آخرین رأی وحدت رویه دیوان عالی",
              "لایحه اعاده دادرسی ماده ۴۷۴",
              "مطالبه مهریه از اجرای ثبت",
              "صلاحیت دادگاه صلح ۱۴۰۲"
            ].map((topic, idx) => (
              <button
                key={idx}
                onClick={() => processUserSpeechTurn(topic)}
                className="px-3 py-1 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-400 hover:text-cyan-300 rounded-xl transition-all shadow-sm"
              >
                ⚡ {topic}
              </button>
            ))}
          </div>
        </div>

        {/* دکمه‌های کنترلی تماس */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-center gap-4">
          <button
            onClick={() => {
              unlockAudio();
              toggleMute();
            }}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg border transition-all ${
              isMuted
                ? "bg-rose-500/20 border-rose-500 text-rose-400"
                : "bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-white"
            }`}
            title={isMuted ? "وصل کردن میکروفون" : "بی‌صدا کردن میکروفون"}
          >
            {isMuted ? "🔇" : "🎙️"}
          </button>

          <button
            onClick={handleEndCall}
            className="w-14 h-14 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center text-2xl shadow-lg shadow-rose-600/30 transition-transform active:scale-95"
            title="پایان مکالمه"
          >
            🔴
          </button>

          {voiceState === "speaking" && (
            <button
              onClick={interruptAiSpeech}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-2xl text-xs text-amber-400 font-semibold transition-colors"
              title="قطع صحبت و سوال جدید"
            >
              ✋ قطع صحبت
            </button>
          )}

          {voiceState === "listening" && (
            <button
              onClick={() => {
                unlockAudio();
                submitSpokenTurn();
              }}
              className="px-3 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 rounded-2xl text-xs text-emerald-300 font-bold transition-all active:scale-95"
              title="ارسال دستی صحبت"
            >
              ➤ ارسال سریع
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default LiveVoiceModal;
