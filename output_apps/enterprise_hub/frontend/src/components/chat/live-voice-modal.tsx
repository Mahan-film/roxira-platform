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

let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked || typeof window === "undefined") return;
  audioUnlocked = true;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      ctx.resume().catch(() => {});
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 200);
    }
  } catch (_) {}
}

if (typeof window !== "undefined") {
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", unlockAudioOnce, opts);
  window.addEventListener("touchstart", unlockAudioOnce, opts);
  window.addEventListener("keydown", unlockAudioOnce, opts);
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
  const animFrameRef = useRef<number | null>(null);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenInThisTurnRef = useRef<boolean>(false);
  const isSubmittingTurnRef = useRef<boolean>(false);
  const activeConversationIdRef = useRef<string>(externalConvId);

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
    if (audioContextRef.current && audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume().catch(() => {});
    }
  }, []);

  const interruptAiSpeech = useCallback(() => {
    if (currentAudioElementRef.current) {
      try {
        currentAudioElementRef.current.pause();
        currentAudioElementRef.current.currentTime = 0;
      } catch (_) {}
      currentAudioElementRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }, []);

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
      recorder.start(150); // دریافت برش‌های صوتی هر ۱۵۰ میلی‌ثانیه
    } catch (err) {
      console.warn("MediaRecorder start notice:", err);
    }
  }, []);

  // استخراج صوت ضبط‌شده و ارسال به سرور
  const transcribeCurrentSegment = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return "";

    try {
      if (recorder.state === "recording") {
        try { recorder.requestData(); } catch (_) {}
      }
      // مکث کوتاه جهت تحویل آخرین قطعه به ondataavailable
      await new Promise((r) => setTimeout(r, 80));

      if (audioChunksRef.current.length === 0) return "";

      const mimeType = recorder.mimeType || "audio/mp4";
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = []; // آماده‌سازی نوبت بعدی

      if (audioBlob.size < 40) return "";

      const ext = /mp4|m4a|aac/i.test(mimeType)
        ? "m4a"
        : /ogg/i.test(mimeType)
        ? "ogg"
        : /wav/i.test(mimeType)
        ? "wav"
        : "webm";

      const formData = new FormData();
      formData.append("file", audioBlob, `speech.${ext}`);

      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 6000);

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
  }, []);

  // بازگشت خودکار به نوبت شنیدن
  const resumeListening = useCallback(() => {
    if (!isComponentOpenRef.current) return;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    isSubmittingTurnRef.current = false;
    hasSpokenInThisTurnRef.current = false;
    setVoiceState("listening");
    setStatusText("بفرمایید، شنونده صحبت شما هستم...");
    setCurrentUserSpeech("");

    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      startRecording();
    }
  }, [startRecording]);

  // پخش صدای هوش مصنوعی
  const playAiVoice = useCallback(async (text: string) => {
    if (!isComponentOpenRef.current) return;

    interruptAiSpeech();
    setVoiceState("speaking");
    setStatusText("در حال پاسخ صوتی...");
    unlockAudio();

    let played = false;
    const safetyWatchdog = setTimeout(() => {
      if (voiceStateRef.current === "speaking") {
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
        await audio.play();
        return true;
      } catch (_) {
        return false;
      }
    };

    try {
      const res = await fetch("/api/v1/apps/judge/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 200) {
          const url = URL.createObjectURL(blob);
          played = await playAudioStream(url);
        }
      }
    } catch (_) {}

    if (!played) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
          const cleanText = text.replace(/[*#_`>]/g, " ").trim().slice(0, 150);
          const utterance = new SpeechSynthesisUtterance(cleanText);
          utterance.lang = "fa-IR";
          utterance.onend = () => resumeListening();
          utterance.onerror = () => resumeListening();
          window.speechSynthesis.speak(utterance);
        } catch (_) {
          resumeListening();
        }
      } else {
        resumeListening();
      }
    }
  }, [interruptAiSpeech, resumeListening, unlockAudio]);

  // پردازش کلام کاربر با هوش مصنوعی
  const processUserSpeechTurn = async (queryText: string) => {
    const text = queryText.trim();
    if (!text || text.length < 2) {
      resumeListening();
      return;
    }

    voiceStateRef.current = "thinking";
    setVoiceState("thinking");
    setStatusText("در حال پردازش پاسخ...");
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
        setTimeout(() => resumeListening(), 1500);
      }
    } catch (err) {
      setStatusText("ارتباط با سرور برقرار نشد.");
      setTimeout(() => resumeListening(), 1500);
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
      setStatusText("در حال پیاده‌سازی صدا...");

      const transcript = await transcribeCurrentSegment();

      if (transcript && transcript.length >= 2) {
        setCurrentUserSpeech(transcript);
        await processUserSpeechTurn(transcript);
      } else {
        setStatusText("صدایی تشخیص داده نشد؛ بفرمایید صحبت کنید...");
        setTimeout(() => resumeListening(), 1200);
      }
    } finally {
      isSubmittingTurnRef.current = false;
    }
  }, [transcribeCurrentSegment, resumeListening]);

  // راه‌اندازی سنسور و اکولایزر بدون نشت صدا به اسپیکر
  const initAudioVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser); // فقط به آنالایزر متصل است، هرگز به destination وصل نمی‌شود تا اکو رخ ندهد
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

        // تشخیص سکوت (VAD) پس از صحبت کاربر
        if (voiceStateRef.current === "listening") {
          if (level > 16) {
            hasSpokenInThisTurnRef.current = true;
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = null;
            }
          } else if (hasSpokenInThisTurnRef.current && level < 12) {
            if (!silenceTimeoutRef.current) {
              silenceTimeoutRef.current = setTimeout(() => {
                silenceTimeoutRef.current = null;
                if (voiceStateRef.current === "listening") {
                  submitSpokenTurn();
                }
              }, 550);
            }
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
    setVoiceState("listening");
    setStatusText("در حال برقراری ارتباط با میکروفون...");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("میکروفون در دسترس نیست.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      initAudioVisualizer(stream);
      startRecording();
      setStatusText("بفرمایید، شنونده صحبت شما هستم...");
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
    setStatusText(newMuted ? "میکروفون موقتاً قطع شد." : "میکروفون متصل شد؛ بفرمایید...");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200" dir="rtl">
      <div className="bg-slate-950 border border-slate-800/90 rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl relative text-center text-slate-100 flex flex-col justify-between max-h-[88vh] overflow-y-auto ring-1 ring-white/10">
        
        {/* هدر مینیمال و پاکیزه بدون هیچ نام مدل یا برچسب اضافی */}
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

        {/* گوی تعاملی و مدرن هوش مصنوعی */}
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

          {/* اکولایزر امواج صوتی فرکانسی مینیمال */}
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

            {/* دکمه مینیمال و صریح برای پایان صحبت و ارسال */}
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
