"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/components/auth/auth-provider";

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LiveVoiceModal({ isOpen, onClose }: LiveVoiceModalProps) {
  const { user } = useAuth();
  const userPhone = user?.phone || "09129367796";

  // حالت‌های گفتگوی صوتی زنده (مشابه ChatGPT Advanced Voice Mode)
  // idle: خاموش | listening: در حال شنیدن صدای کاربر | thinking: تحلیل ادله و آماده‌سازی پاسخ | speaking: هوش مصنوعی در حال صحبت
  const [voiceState, setVoiceState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [statusText, setStatusText] = useState("برای شروع گفتگوی زنده صوتی، روی دکمه تماس بزنید.");
  const [currentUserSpeech, setCurrentUserSpeech] = useState("");
  const [lastAiResponse, setLastAiResponse] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // مراجع سراسری برای چرخه Full-Duplex و قطع لحظه‌ای (Barge-in)
  const voiceStateRef = useRef(voiceState);
  const isMutedRef = useRef(isMuted);
  const isComponentOpenRef = useRef(isOpen);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);

  // بافرهای مدیریت نوبت و سکوت (Turn-Taking VAD)
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
      // باز شدن مدال: راه‌اندازی فوری مکالمه بدون معطلی
      handleStartCall();
    }
  }, [isOpen]);

  // متوقف کردن بلادرنگ صدای هوش مصنوعی در صورت مداخله کاربر (Barge-in)
  const interruptAiSpeech = useCallback(() => {
    if (currentAudioElementRef.current) {
      try {
        currentAudioElementRef.current.pause();
        currentAudioElementRef.current.currentTime = 0;
      } catch (_) {}
      currentAudioElementRef.current = null;
    }
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
  }, []);

  // پخش صدای هوش مصنوعی با اولویت TTS سرور و فالبک آنی مرورگر
  const playAiVoice = useCallback(async (text: string) => {
    if (!isComponentOpenRef.current) return;

    interruptAiSpeech();
    setVoiceState("speaking");
    setStatusText("🔊 قاضی هوشمند در حال پاسخگویی صوتی...");

    let playedViaServer = false;

    // استراتژی ۱: استفاده از اندپوینت تخصصی OpenRouter TTS (/api/v1/apps/judge/speak)
    try {
      const response = await fetch("/api/v1/apps/judge/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 350), voice: "alloy" }),
      });

      if (response.ok && response.headers.get("content-type")?.includes("audio")) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        currentAudioElementRef.current = audio;

        audio.onended = () => {
          if (isComponentOpenRef.current) {
            setVoiceState("listening");
            setStatusText("🟢 گوش می‌دهم؛ بفرمایید...");
            accumulatedSpeechRef.current = "";
            hasSpokenInThisTurnRef.current = false;
          }
        };
        audio.onerror = () => {
          // در صورت بروز هر خطایی در پخش صوت سرور، فوراً به سینت سایزر مرورگر فالبک کن
          fallbackBrowserTts(text);
        };

        await audio.play();
        playedViaServer = true;
      }
    } catch (e) {
      console.warn("Server TTS skipped, using browser speech synthesis:", e);
    }

    // استراتژی ۲: فالبک به Web Speech Synthesis فارسی
    if (!playedViaServer) {
      fallbackBrowserTts(text);
    }
  }, [interruptAiSpeech]);

  const fallbackBrowserTts = (text: string) => {
    if (!("speechSynthesis" in window)) {
      setVoiceState("listening");
      setStatusText("🟢 گوش می‌دهم؛ بفرمایید...");
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      utterance.rate = 1.05;

      utterance.onstart = () => {
        setVoiceState("speaking");
        setStatusText("🔊 قاضی هوشمند در حال ارائه راهکار حقوقی...");
      };
      utterance.onend = () => {
        if (isComponentOpenRef.current) {
          setVoiceState("listening");
          setStatusText("🟢 گوش می‌دهم؛ بفرمایید...");
          accumulatedSpeechRef.current = "";
          hasSpokenInThisTurnRef.current = false;
        }
      };
      utterance.onerror = () => {
        if (isComponentOpenRef.current) {
          setVoiceState("listening");
          setStatusText("🟢 گوش می‌دهم؛ بفرمایید...");
          accumulatedSpeechRef.current = "";
          hasSpokenInThisTurnRef.current = false;
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      setVoiceState("listening");
      setStatusText("🟢 گوش می‌دهم؛ بفرمایید...");
    }
  };

  // ارسال خودکار کلام کاربر به موتور حقوقی RAG
  const processUserSpeechTurn = async (queryText: string) => {
    const text = (queryText || accumulatedSpeechRef.current).trim();
    if (!text || text.length < 2) {
      setVoiceState("listening");
      setStatusText("🟢 صدایی دریافت نشد؛ بفرمایید...");
      hasSpokenInThisTurnRef.current = false;
      return;
    }

    // تغییر وضعیت به پردازش و تفکر هوش مصنوعی
    setVoiceState("thinking");
    setStatusText("⚖️ قاضی هوشمند در حال تحلیل ادله و بررسی قوانین و آرا...");
    setCurrentUserSpeech(text);
    accumulatedSpeechRef.current = "";
    hasSpokenInThisTurnRef.current = false;

    try {
      const res = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          user_phone: userPhone,
          phone: userPhone,
          is_vip: true,
          tier: "VIP",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.reply || data.response || "موضوع شما بر اساس رویه قضایی و قوانین لازم‌الاجرا بررسی شد.";
        setLastAiResponse(reply);
        await playAiVoice(reply);
      } else {
        setStatusText("خطا در برقراری ارتباط با موتور قاضی. لطفاً دوباره بفرمایید...");
        setVoiceState("listening");
      }
    } catch (err) {
      console.error("AI consult error:", err);
      setStatusText("خطای ارتباط. لطفاً مجدداً مطرح فرمایید...");
      setVoiceState("listening");
    }
  };

  // مانیتورینگ صوتی و استخراج شدت صدا جهت انیمیشن گوی تعاملی و VAD
  const initAudioVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

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

        // قطع لحظه‌ای (Barge-in): اگر کاربر در حین صحبت هوش مصنوعی شروع به صحبت کند
        if (voiceStateRef.current === "speaking" && level > 24) {
          interruptAiSpeech();
          setVoiceState("listening");
          setStatusText("🟢 در حال شنیدن کلام جدید شما...");
          accumulatedSpeechRef.current = "";
          hasSpokenInThisTurnRef.current = true;
        }

        // ردیابی سکوت هوشمند (Voice Activity Detection)
        if (voiceStateRef.current === "listening") {
          if (level > 16) {
            hasSpokenInThisTurnRef.current = true;
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = null;
            }
          } else if (hasSpokenInThisTurnRef.current && level < 10) {
            // کاربر بعد از صحبت، حدود ۱.۱ ثانیه سکوت کرده -> پایان خودکار نوبت
            if (!silenceTimeoutRef.current && accumulatedSpeechRef.current.trim().length > 3) {
              silenceTimeoutRef.current = setTimeout(() => {
                silenceTimeoutRef.current = null;
                if (voiceStateRef.current === "listening" && accumulatedSpeechRef.current.trim()) {
                  processUserSpeechTurn(accumulatedSpeechRef.current);
                }
              }, 1100);
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

  // راه‌اندازی گفتار به متن بلادرنگ مرورگر (Web Speech API) با پشتیبانی سافاری مک/آیفون و کروم
  const initSpeechRecognition = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
      }

      const recognition = new SpeechRecognition();
      recognition.lang = "fa-IR";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      recognition.onresult = (event: any) => {
        if (isMutedRef.current) return;

        // در صورت صحبت حین پاسخ هوش مصنوعی، فوراً صدای هوش مصنوعی را قطع کن (Barge-in)
        if (voiceStateRef.current === "speaking") {
          interruptAiSpeech();
          setVoiceState("listening");
        }

        let interim = "";
        let final = "";
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        const fullSpoken = (final + " " + interim).trim();
        if (fullSpoken) {
          accumulatedSpeechRef.current = fullSpoken;
          setCurrentUserSpeech(fullSpoken);
          hasSpokenInThisTurnRef.current = true;
          setStatusText(`در حال شنیدن: «${fullSpoken}»`);

          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }

          // سکوت اتوماتیک پس از پایان جمله
          silenceTimeoutRef.current = setTimeout(() => {
            silenceTimeoutRef.current = null;
            if (voiceStateRef.current === "listening" && accumulatedSpeechRef.current.trim()) {
              processUserSpeechTurn(accumulatedSpeechRef.current);
            }
          }, 1100);
        }
      };

      recognition.onerror = (e: any) => {
        console.warn("Speech recognition notice:", e);
      };

      recognition.onend = () => {
        // بازراه‌اندازی خودکار تا زمان باز بودن مدال
        if (isComponentOpenRef.current && voiceStateRef.current !== "idle") {
          try {
            recognition.start();
          } catch (_) {}
        }
      };

      recognition.start();
    } catch (e) {
      console.warn("SpeechRecognition start notice:", e);
    }
  };

  // آغاز مکالمه بدون تأخیر
  const handleStartCall = async () => {
    interruptAiSpeech();
    setCurrentUserSpeech("");
    setLastAiResponse("");
    accumulatedSpeechRef.current = "";
    hasSpokenInThisTurnRef.current = false;
    setVoiceState("listening");
    setStatusText("🎙️ در حال اتصال میکروفون با امنیت کامل...");

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("مرورگر شما از ورودی میکروفون پشتیبانی نمی‌کند.");
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
      initSpeechRecognition();
      setStatusText("🟢 آماده صحبت؛ بفرمایید (مثلاً: «در مورد ماده ۴۷۴ توضیح بده»)");
    } catch (err: any) {
      console.error("Microphone access error:", err);
      setVoiceState("idle");
      setStatusText("⚠️ دسترسی به میکروفون داده نشد. لطفاً در نوار آدرس مرورگر تایید فرمایید.");
    }
  };

  // پایان مکالمه
  const handleEndCall = () => {
    interruptAiSpeech();
    setVoiceState("idle");
    setStatusText("مکالمه پایان یافت.");
    setAudioLevel(0);
    accumulatedSpeechRef.current = "";

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (_) {}
      recognitionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try { audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }
  };

  // قطع و وصل میکروفون (Mute)
  const toggleMute = () => {
    if (!streamRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    streamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted;
    });
    if (newMuted) {
      setStatusText("🔇 میکروفون قطع شد.");
    } else {
      setStatusText("🟢 میکروفون وصل شد؛ بفرمایید...");
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

        {/* برچسب فوق‌پیشرفته نسل جدید Real-Time Voice */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="px-4 py-1.5 bg-gradient-to-r from-cyan-500/10 via-emerald-500/10 to-purple-500/10 border border-cyan-500/30 text-cyan-300 text-xs rounded-full font-medium flex items-center gap-2 shadow-sm">
            <span className={`w-2 h-2 rounded-full ${
              voiceState === "speaking" ? "bg-purple-400 animate-ping" :
              voiceState === "thinking" ? "bg-amber-400 animate-spin" :
              voiceState === "listening" ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
            }`} />
            <span>مکالمه زنده ریل‌تایم با قاضی هوشمند (Full-Duplex AI)</span>
          </span>
        </div>

        {/* گوی شناور تعاملی و سیال هوش مصنوعی (مشابه ChatGPT Advanced Voice Mode) */}
        <div className="my-8 flex flex-col items-center justify-center space-y-6">
          <div className="relative flex items-center justify-center w-48 h-48 sm:w-56 sm:h-56">
            
            {/* هاله امواج صوتی خارجی (پالس بر اساس شدت صدای واقعی) */}
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

            {/* حلقه تنفس نورانی و چندوجهی */}
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

            {/* گوی اصلی هوش مصنوعی با گرادیان پویا */}
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

            {/* زیرنویس زنده کلام کاربر */}
            {currentUserSpeech && (
              <div className="bg-slate-950/80 border border-slate-800/90 p-3 rounded-2xl text-xs text-slate-300 text-right shadow-inner animate-in fade-in">
                <span className="text-cyan-400 font-bold ml-1.5">شما:</span>
                <span>{currentUserSpeech}</span>
              </div>
            )}

            {/* پاسخ استنتاجی و مستند هوش مصنوعی */}
            {lastAiResponse && (
              <div className="bg-slate-950/90 border border-slate-800 p-4 rounded-2xl text-right text-xs text-slate-200 max-h-40 overflow-y-auto leading-relaxed border-r-2 border-r-purple-400 shadow-inner animate-in fade-in">
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

          {/* موضوعات سریع پیشنهادی (یک‌کلیک بدون نیاز به تایپ) */}
          <div className="flex flex-wrap justify-center gap-1.5 pt-2">
            {[
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

        {/* دکمه‌های کنترلی تماس (Mute / پایان تماس / صحبت دستی) */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-center gap-4">
          <button
            onClick={toggleMute}
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
        </div>
      </div>
    </div>
  );
}

export default LiveVoiceModal;
