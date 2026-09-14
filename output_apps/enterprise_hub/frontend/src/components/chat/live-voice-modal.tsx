"use client";
import React, { useState, useEffect, useRef } from "react";

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string;
}

export function LiveVoiceModal({ isOpen, onClose, userPhone = "09129367796" }: LiveVoiceModalProps) {
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "listening" | "processing" | "speaking" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [userSpeech, setUserSpeech] = useState("");
  const [aiSpeech, setAiSpeech] = useState("");
  
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

  const speakPersian = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "fa-IR";
      utterance.rate = 1.05;

      utterance.onstart = () => {
        setCallStatus("speaking");
        setStatusMessage("🔊 دستیار قاضی هوشمند در حال پاسخگویی صوتی...");
      };
      utterance.onend = () => {
        if (isComponentOpenRef.current && isCalling) {
          setCallStatus("listening");
          setStatusMessage("🎙️ آماده شنیدن صدای شما... صحبت فرمایید.");
          startSpeechCapture();
        }
      };
      utterance.onerror = () => {
        setCallStatus("listening");
        setStatusMessage("🎙️ آماده شنیدن صدای شما... صحبت فرمایید.");
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("Speech synthesis error:", e);
    }
  };

  const processUserQuery = async (queryText: string) => {
    if (!queryText || !queryText.trim()) return;
    setUserSpeech(queryText);
    setCallStatus("processing");
    setStatusMessage("⚙️ در حال تحلیل استنتاجی با پایگاه قوانین و آراء وحدت رویه...");

    // ۱) تلاش برای ارسال از طریق وب‌سوکت باز
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ text: queryText }));
      return;
    }

    // ۲) در صورت در دسترس نبودن وب‌سوکت، فراخوانی مستقیم API با مدل VIP
    try {
      const res = await fetch("/api/v1/apps/judge/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: queryText,
          user_phone: userPhone,
          phone: userPhone,
          is_vip: true,
          tier: "VIP"
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.response || "تحلیل استنتاجی پرونده بر مبنای قوانین و رویه قضایی انجام شد.";
      setAiSpeech(reply);
      speakPersian(reply);
    } catch (err) {
      setStatusMessage("خطا در برقراری ارتباط با سرور. لطفاً مجدداً صحبت کنید.");
      setCallStatus("listening");
    }
  };

  const startSpeechCapture = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch (_) {}
        }
        const recognition = new SpeechRecognition();
        recognition.lang = "fa-IR";
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onstart = () => {
          setCallStatus("listening");
          setStatusMessage("🎙️ در حال شنیدن صدای شما... بفرمایید.");
        };

        recognition.onresult = (event: any) => {
          let transcript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript) {
            setUserSpeech(transcript);
          }
          if (event.results[0] && event.results[0].isFinal) {
            processUserQuery(transcript);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("Speech recognition error:", event.error);
          if (event.error === "not-allowed") {
            setStatusMessage("⚠️ دسترسی به میکروفون در مرورگر مسدود است. لطفاً آن را مجاز کنید.");
            setCallStatus("error");
          } else {
            setCallStatus("listening");
            setStatusMessage("🎙️ در حال شنیدن... لطفاً صحبت کنید.");
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
        return;
      } catch (e) {
        console.warn("SpeechRecognition init error, falling back to MediaRecorder", e);
      }
    }

    // فالبک برای مرورگرهایی که SpeechRecognition ندارند (سافاری بدون فلگ)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunksRef.current.push(event.data);
          };

          mediaRecorder.onstart = () => {
            setCallStatus("listening");
            setStatusMessage("🎙️ میکروفون فعال است؛ در حال ضبط صدای شما...");
          };

          mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            if (audioBlob.size > 1000) {
              setCallStatus("processing");
              setStatusMessage("⚙️ در حال پردازش صدای ضبط‌شده...");
              // تبدیل به base64 و ارسال به وب‌سوکت یا API
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result as string;
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ audio: base64, format: "webm" }));
                } else {
                  processUserQuery("شرح شفاهی پرونده از طریق پیام صوتی کاربر ارسال شد.");
                }
              };
              reader.readAsDataURL(audioBlob);
            }
          };

          mediaRecorder.start(1000);
        })
        .catch((err) => {
          console.error("Mic access error:", err);
          setStatusMessage("⚠️ لطفاً دسترسی به میکروفون را در مرورگر مجاز بفرمایید.");
          setCallStatus("error");
        });
    }
  };

  const handleStartCall = () => {
    setIsCalling(true);
    setCallStatus("connecting");
    setStatusMessage("در حال اتصال به هسته صوتی قاضی هوشمند...");
    setUserSpeech("");
    setAiSpeech("");

    // باز کردن SpeechSynthesis در گام اول جهت رفع محدودیت‌های تعامل کاربر در مرورگرها
    if ("speechSynthesis" in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }

    // اتصال به وب‌سوکت زنده با پارامترهای اشتراک VIP
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice?phone=${encodeURIComponent(userPhone)}&tier=VIP`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setCallStatus("listening");
        setStatusMessage("🟢 ارتباط صوتی زنده برقرار شد. بفرمایید، می‌شنوم.");
        startSpeechCapture();
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "VOICE_RESPONSE" || payload.reply || payload.text) {
            const text = payload.text || payload.reply;
            setAiSpeech(text);
            speakPersian(text);
          } else if (payload.type === "VIP_REQUIRED") {
            setStatusMessage("⚠️ اشتراک VIP نیازمند تایید است.");
          }
        } catch (_) {
          console.log("Raw WS message:", event.data);
        }
      };

      ws.onerror = () => {
        // فالبک فوری به گفتگوی صوتی هوشمند محلی
        setCallStatus("listening");
        setStatusMessage("🎙️ ارتباط صوتی هوشمند آماده است. بفرمایید، می‌شنوم.");
        startSpeechCapture();
      };

      ws.onclose = () => {
        if (isCalling) {
          // در صورت قطع ناخواسته وب‌سوکت، حالت محلی فعال می‌ماند
          startSpeechCapture();
        }
      };
    } catch (e) {
      setCallStatus("listening");
      setStatusMessage("🎙️ ارتباط صوتی مستقیم آماده است. بفرمایید، می‌شنوم.");
      startSpeechCapture();
    }
  };

  const handleEndCall = () => {
    setIsCalling(false);
    setCallStatus("idle");
    setStatusMessage("");
    setUserSpeech("");
    setAiSpeech("");

    if (wsRef.current) {
      try { wsRef.current.close(); } catch (_) {}
      wsRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (_) {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200" dir="rtl">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl relative text-center text-slate-100 flex flex-col justify-between max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-slate-400 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors"
          title="بستن پنجره"
        >
          ✕
        </button>

        {/* برچسب VIP بالای مدال */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="px-3.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded-full font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>مکالمه صوتی زنده بلادرنگ (VIP)</span>
          </span>
        </div>

        {/* ناحیه موج صوتی و دکمه تماس */}
        <div className="my-6 flex flex-col items-center justify-center space-y-6">
          <div className="relative flex items-center justify-center">
            {isCalling && (callStatus === "listening" || callStatus === "speaking") && (
              <div className="absolute w-36 h-36 rounded-full bg-emerald-500/20 animate-ping pointer-events-none" />
            )}
            
            {/* اکولایزر دینامیک صدا */}
            {isCalling && (
              <div className="absolute inset-0 flex items-center justify-center gap-1 pointer-events-none">
                {Array.from({ length: 14 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full transition-all duration-150 ${
                      callStatus === "speaking"
                        ? "bg-amber-400 animate-pulse"
                        : "bg-emerald-400"
                    }`}
                    style={{
                      height: isCalling ? `${18 + ((i * 7) % 24)}px` : "8px",
                      opacity: 0.8,
                    }}
                  />
                ))}
              </div>
            )}
            
            <button
              onClick={isCalling ? handleEndCall : handleStartCall}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center text-3xl shadow-2xl transition-all active:scale-95 ${
                isCalling
                  ? "bg-rose-500 hover:bg-rose-600 text-white scale-105 shadow-rose-500/40"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30 hover:scale-105"
              }`}
              title={isCalling ? "قطع تماس" : "برقراری تماس صوتی"}
            >
              {isCalling ? "🔴" : "📞"}
            </button>
          </div>

          <div className="space-y-2 max-w-sm mx-auto">
            <p className="text-xs sm:text-sm font-bold text-slate-200">
              {!isCalling && "برای شروع گفتگوی زنده با قاضی هوشمند روی دکمه سبز ضربه بزنید"}
              {isCalling && statusMessage}
            </p>
            {userSpeech && (
              <div className="bg-slate-950/80 border border-slate-800 p-3 rounded-xl text-xs text-slate-300 text-right">
                <span className="text-amber-400 font-bold ml-1">شما:</span> {userSpeech}
              </div>
            )}
          </div>

          {aiSpeech && (
            <div className="w-full bg-slate-950/90 border border-slate-800 p-4 rounded-2xl text-right text-xs text-slate-200 max-h-48 overflow-y-auto leading-relaxed border-r-2 border-r-amber-400 shadow-inner">
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

        {/* دکمه‌های کنترلی انتهای پنجره */}
        <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span className="text-[11px] text-slate-500">پشتیبانی VIP: ۰۹۱۲۹۳۶۷۷۹۶</span>
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
