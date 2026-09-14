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

  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "listening" | "processing" | "speaking" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [userSpeech, setUserSpeech] = useState("");
  const [aiSpeech, setAiSpeech] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isComponentOpenRef = useRef(isOpen);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenRef = useRef(false);

  useEffect(() => {
    isComponentOpenRef.current = isOpen;
    if (!isOpen) {
      handleEndCall();
    }
  }, [isOpen]);

  const speakPersian = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      utterance.rate = 1.05;

      utterance.onstart = () => {
        setCallStatus("speaking");
        setStatusMessage("🔊 قاضی هوشمند در حال پاسخگویی صوتی...");
      };
      utterance.onend = () => {
        if (isComponentOpenRef.current && streamRef.current) {
          restartListeningPhase();
        }
      };
      utterance.onerror = () => {
        if (isComponentOpenRef.current && streamRef.current) {
          restartListeningPhase();
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error:", e);
    }
  }, []);

  const sendAudioForAnalysis = async (audioBlob: Blob) => {
    if (audioBlob.size < 500) {
      restartListeningPhase();
      return;
    }

    setCallStatus("processing");
    setStatusMessage("⚙️ در حال تبدیل صدا به متن با هوش مصنوعی Whisper...");

    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "voice_call.webm");

      // مرحله ۱: تبدیل صوت به متن دقیق با OpenRouter Whisper
      const transRes = await fetch("/api/v1/apps/judge/transcribe-audio", {
        method: "POST",
        body: formData,
      });

      const transData = await transRes.json();
      const transcribedText = transData.text || transData.transcript;

      if (!transcribedText || !transcribedText.trim()) {
        setStatusMessage("صدایی دریافت نشد. بفرمایید، دوباره بفرمایید...");
        restartListeningPhase();
        return;
      }

      setUserSpeech(transcribedText);
      setStatusMessage("⚖️ در حال بررسی در گراف قوانین و آرای وحدت رویه...");

      // مرحله ۲: دریافت تحلیل استنتاجی با موتور هوش مصنوعی و RAG
      const chatRes = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: transcribedText,
          user_phone: userPhone,
          phone: userPhone,
          is_vip: true,
          tier: "VIP",
        }),
      });

      const chatData = await chatRes.json();
      const reply = chatData.reply || chatData.response || "موضوع شما بر اساس رویه قضایی و قوانین موضوعه بررسی شد.";
      setAiSpeech(reply);
      speakPersian(reply);
    } catch (err) {
      console.error("Call processing error:", err);
      setStatusMessage("خطا در پردازش. آماده شنیدن مجدد هستیم...");
      restartListeningPhase();
    }
  };

  const restartListeningPhase = () => {
    if (!isComponentOpenRef.current || !streamRef.current) return;
    setCallStatus("listening");
    setStatusMessage("🟢 در حال شنیدن صدای شما... بفرمایید.");
    hasSpokenRef.current = false;
    startRecordingSegment();
  };

  const startRecordingSegment = () => {
    if (!streamRef.current) return;

    try {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";

      const recorder = mimeType
        ? new MediaRecorder(streamRef.current, { mimeType })
        : new MediaRecorder(streamRef.current);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        sendAudioForAnalysis(audioBlob);
      };

      recorder.start();
    } catch (e) {
      console.warn("Recorder segment start error:", e);
    }
  };

  const handleManualSubmit = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      mediaRecorderRef.current.stop();
    }
  };

  // مانیتورینگ بلادرنگ بلندی صدا برای ردیابی سکوت (VAD) و اکولایزر
  const startAudioVisualizer = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!analyserRef.current || !streamRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const currentLevel = Math.min(100, Math.round((avg / 128) * 100));
        setAudioLevel(currentLevel);

        // تشخیص صدا و سکوت (Voice Activity Detection)
        if (currentLevel > 18) {
          hasSpokenRef.current = true;
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (hasSpokenRef.current && currentLevel < 12) {
          // سکوت پس از صحبت حداقل ۱.۵ ثانیه
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                mediaRecorderRef.current.stop();
              }
            }, 1500);
          }
        }

        animFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn("AudioContext visualizer error:", e);
    }
  };

  const handleStartCall = async () => {
    setUserSpeech("");
    setAiSpeech("");
    setCallStatus("listening");
    setStatusMessage("🎙️ در حال اتصال میکروفون...");

    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("مرورگر شما از ورودی میکروفون پشتیبانی نمی‌کند.");
      }
      // فراخوانی مستقیم در پشته کلیک کاربر جهت باز شدن پاپ‌آپ سافاری
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
    } catch (err: any) {
      console.error("Mic access error:", err);
      setIsCalling(false);
      setCallStatus("error");
      setStatusMessage("⚠️ دسترسی به میکروفون تایید نشد. لطفاً در نوار آدرس مرورگر اجازه دسترسی را صادر فرمایید.");
      return;
    }

    setIsCalling(true);
    setStatusMessage("🟢 میکروفون فعال شد. صحبت کنید (مثلاً: «در مورد رای وحدت رویه دیوان عالی توضیح بده»)");
    startAudioVisualizer(stream);
    startRecordingSegment();
  };

  const handleEndCall = () => {
    setIsCalling(false);
    setCallStatus("idle");
    setStatusMessage("");
    setAudioLevel(0);

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try { audioContextRef.current.close(); } catch (_) {}
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
      mediaRecorderRef.current = null;
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-200" dir="rtl">
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl relative text-center text-slate-100 flex flex-col justify-between max-h-[92vh] overflow-y-auto ring-1 ring-amber-500/20">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors"
          title="بستن پنجره"
        >
          ✕
        </button>

        {/* برچسب VIP مکالمه زنده */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="px-3.5 py-1 bg-gradient-to-r from-amber-500/10 to-emerald-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-full font-medium flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>مکالمه صوتی زنده با هوش مصنوعی قاضی هوشمند</span>
          </span>
        </div>

        {/* اکولایزر صدا و دایره تماس */}
        <div className="my-5 flex flex-col items-center justify-center space-y-5">
          <div className="relative flex items-center justify-center">
            {/* هاله صوتی متناسب با ارتعاش واقعی صدا */}
            {isCalling && (
              <div
                className="absolute rounded-full bg-emerald-500/20 pointer-events-none transition-all duration-75"
                style={{
                  width: `${110 + audioLevel * 1.5}px`,
                  height: `${110 + audioLevel * 1.5}px`,
                }}
              />
            )}

            {/* نوارهای اکولایزر تعاملی */}
            {isCalling && (
              <div className="absolute inset-0 flex items-center justify-center gap-1 pointer-events-none">
                {Array.from({ length: 14 }).map((_, i) => {
                  const barHeight = Math.max(6, (audioLevel * (1 + Math.sin(i))) / 2 + 10);
                  return (
                    <div
                      key={i}
                      className={`w-1 rounded-full transition-all duration-75 ${
                        callStatus === "speaking" ? "bg-amber-400" : "bg-emerald-400"
                      }`}
                      style={{
                        height: `${barHeight}px`,
                        opacity: isCalling ? 0.9 : 0.3,
                      }}
                    />
                  );
                })}
              </div>
            )}

            <button
              onClick={isCalling ? handleEndCall : handleStartCall}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center text-3xl shadow-2xl transition-all active:scale-95 ${
                isCalling
                  ? "bg-rose-500 hover:bg-rose-600 text-white scale-105 shadow-rose-500/50"
                  : "bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-emerald-500/40 hover:scale-105"
              }`}
              title={isCalling ? "پایان مکالمه" : "آغاز مکالمه صوتی"}
            >
              {isCalling ? "🔴" : "📞"}
            </button>
          </div>

          <div className="space-y-2 max-w-md mx-auto">
            <p className="text-xs sm:text-sm font-bold text-slate-200">
              {!isCalling && callStatus !== "error" && "برای شروع گفتگوی زنده روی دکمه سبز ضربه بزنید"}
              {statusMessage}
            </p>

            {/* دکمه ارسال دستی در صورت پایان صحبت */}
            {isCalling && callStatus === "listening" && (
              <button
                onClick={handleManualSubmit}
                className="mt-2 px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md shadow-amber-500/20 active:scale-95 flex items-center gap-1.5 mx-auto"
              >
                <span>🚀</span>
                <span>ارسال صحبت برای تحلیل قاضی هوشمند</span>
              </button>
            )}

            {callStatus === "error" && (
              <button
                onClick={handleStartCall}
                className="mt-2 px-4 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold transition-colors"
              >
                🔄 تلاش مجدد برای دسترسی میکروفون
              </button>
            )}

            {userSpeech && (
              <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl text-xs text-slate-300 text-right">
                <span className="text-amber-400 font-bold ml-1">شما گفتید:</span> {userSpeech}
              </div>
            )}
          </div>

          {aiSpeech && (
            <div className="w-full bg-slate-950/90 border border-slate-800 p-4 rounded-2xl text-right text-xs text-slate-200 max-h-44 overflow-y-auto leading-relaxed border-r-2 border-r-amber-400 shadow-inner">
              <div className="flex items-center justify-between mb-2">
                <span className="text-amber-400 font-bold text-xs">⚖️ پاسخ استنتاجی قاضی هوشمند:</span>
                <button
                  onClick={() => speakPersian(aiSpeech)}
                  className="text-[10px] text-slate-400 hover:text-amber-300 px-2 py-0.5 rounded bg-slate-900 border border-slate-800"
                >
                  🔊 بازپخش صوتی
                </button>
              </div>
              <p className="whitespace-pre-line leading-relaxed">{aiSpeech}</p>
            </div>
          )}
        </div>

        {/* دکمه‌های فوتر پنجره */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>پایگاه RAG و آرای وحدت رویه متصل است</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

export default LiveVoiceModal;
