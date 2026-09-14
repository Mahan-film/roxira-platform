"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string;
}

export function LiveVoiceModal({ isOpen, onClose, userPhone = "09129367796" }: LiveVoiceModalProps) {
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "requesting_mic" | "listening" | "processing" | "speaking" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [userSpeech, setUserSpeech] = useState("");
  const [aiSpeech, setAiSpeech] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const isComponentOpenRef = useRef(isOpen);

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
          setCallStatus("listening");
          setStatusMessage("🎙️ در حال شنیدن صدای شما... صحبت فرمایید.");
        }
      };
      utterance.onerror = () => {
        if (isComponentOpenRef.current && streamRef.current) {
          setCallStatus("listening");
          setStatusMessage("🎙️ در حال شنیدن صدای شما... صحبت فرمایید.");
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error:", e);
    }
  }, []);

  const processQuery = useCallback(async (queryText: string) => {
    if (!queryText || !queryText.trim()) return;
    setUserSpeech(queryText);
    setCallStatus("processing");
    setStatusMessage("⚙️ در حال استخراج ادله و تحلیل با قوانین و رویه قضایی...");

    // اولویت ۱: ارسال از طریق وب‌سوکت در صورت باز بودن
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ text: queryText }));
      return;
    }

    // اولویت ۲: فراخوانی اندپوینت مستقیم چت با مدل VIP
    try {
      const res = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: queryText,
          user_phone: userPhone,
          phone: userPhone,
          is_vip: true,
          tier: "VIP",
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.response || "تحلیل استنتاجی پرونده انجام شد.";
      setAiSpeech(reply);
      speakPersian(reply);
    } catch (err) {
      setStatusMessage("خطا در پاسخ‌دهی هوش مصنوعی. لطفاً مجدداً صحبت فرمایید.");
      setCallStatus("listening");
    }
  }, [speakPersian, userPhone]);

  // حلقه مانیتورینگ بلادرنگ صدای میکروفون جهت حرکت امواج صوتی
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
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn("AudioContext visualizer error:", e);
    }
  };

  // شروع مکالمه صوتی زنده (مستقیماً در کلیک کاربر جهت احراز صلاحیت سافاری/iOS)
  const handleStartCall = async () => {
    setCallStatus("requesting_mic");
    setStatusMessage("🎙️ در حال فعال‌سازی میکروفون در مرورگر...");
    setUserSpeech("");
    setAiSpeech("");

    // ۱) اجرای آنی getUserMedia در پشته کلیک کاربر (حیاتی برای Safari در Mac و iPhone)
    let stream: MediaStream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("مرورگر شما از ورودی میکروفون پشتیبانی نمی‌کند.");
      }
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
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setStatusMessage("⚠️ دسترسی به میکروفون تایید نشد. لطفاً در نوار آدرس مرورگر اجازه دسترسی را صادر فرمایید.");
      } else {
        setStatusMessage("⚠️ میکروفون یافت نشد یا در دسترس نیست.");
      }
      return;
    }

    // دسترسی تایید شد
    setIsCalling(true);
    setCallStatus("listening");
    setStatusMessage("🟢 میکروفون فعال است. بفرمایید، در حال شنیدن صدای شما هستیم...");
    startAudioVisualizer(stream);

    // ۲) ضبط صدا با MediaRecorder
    try {
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          if (blob.size > 2000 && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result as string;
              wsRef.current?.send(JSON.stringify({ audio: base64, format: "webm" }));
            };
            reader.readAsDataURL(blob);
          }
        }
      };

      recorder.start(1000);
    } catch (recErr) {
      console.warn("MediaRecorder start error:", recErr);
    }

    // ۳) راه‌اندازی گفتار به متن همزمان (Web Speech API) در صورت پشتیبانی
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = "fa-IR";
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (e: any) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) {
              const finalTranscript = e.results[i][0].transcript;
              if (finalTranscript.trim()) {
                processQuery(finalTranscript);
              }
            } else {
              interim += e.results[i][0].transcript;
            }
          }
          if (interim) setUserSpeech(interim);
        };

        recognition.onerror = (e: any) => {
          console.log("Speech recognition info:", e.error);
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (recInitErr) {
        console.warn("SpeechRecognition start error:", recInitErr);
      }
    }

    // ۴) اتصال وب‌سوکت با پارامترهای VIP
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice?phone=${encodeURIComponent(userPhone)}&tier=VIP`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const reply = payload.text || payload.reply;
          if (reply) {
            setAiSpeech(reply);
            speakPersian(reply);
          }
        } catch (_) {}
      };
    } catch (wsErr) {
      console.warn("WebSocket init error:", wsErr);
    }
  };

  const handleEndCall = () => {
    setIsCalling(false);
    setCallStatus("idle");
    setStatusMessage("");
    setAudioLevel(0);

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
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      recognitionRef.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
      wsRef.current = null;
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

        {/* برچسب اختصاصی VIP */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <span className="px-3.5 py-1 bg-gradient-to-r from-amber-500/10 to-emerald-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-full font-medium flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>مکالمه صوتی زنده بلادرنگ (VIP دادرسی)</span>
          </span>
        </div>

        {/* دایره صوتی و اکولایزر تعاملی */}
        <div className="my-5 flex flex-col items-center justify-center space-y-5">
          <div className="relative flex items-center justify-center">
            {/* هاله امواج دینامیک با توجه به حجم واقعی صدای کاربر */}
            {isCalling && (
              <div
                className="absolute rounded-full bg-emerald-500/20 pointer-events-none transition-all duration-75"
                style={{
                  width: `${110 + audioLevel * 1.5}px`,
                  height: `${110 + audioLevel * 1.5}px`,
                }}
              />
            )}

            {/* نوارهای اکولایزر زنده متصل به AudioContext */}
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
                <span className="text-amber-400 font-bold ml-1">شما:</span> {userSpeech}
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

        {/* دکمه‌های کنترل و فوتر پنجره */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px] text-slate-400 font-mono">اشتراک فعال: ۰۹۱۲۹۳۶۷۷۹۶ (VIP)</span>
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
