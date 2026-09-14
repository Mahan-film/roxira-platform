"use client";
import React, { useState, useEffect, useRef } from "react";

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  userPhone?: string;
}

export function LiveVoiceModal({ isOpen, onClose, userPhone = "09129367796" }: LiveVoiceModalProps) {
  const [isCalling, setIsCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<"idle" | "listening" | "processing" | "speaking">("idle");
  const [userSpeech, setUserSpeech] = useState("");
  const [aiSpeech, setAiSpeech] = useState("");
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) {
      handleEndCall();
    }
  }, [isOpen]);

  const speakPersian = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fa-IR";
    utterance.rate = 1.05;

    utterance.onstart = () => setCallStatus("speaking");
    utterance.onend = () => {
      setCallStatus("listening");
      startListeningLoop();
    };

    window.speechSynthesis.speak(utterance);
  };

  const startListeningLoop = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      if (recognitionRef.current) recognitionRef.current.abort();

      const recognition = new SpeechRecognition();
      recognition.lang = "fa-IR";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => setCallStatus("listening");
      recognition.onresult = async (event: any) => {
        const text = event.results[0][0].transcript;
        if (!text || text.trim() === "") return;
        
        setUserSpeech(text);
        setCallStatus("processing");

        try {
          const res = await fetch("/api/v1/apps/judge/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: text }],
              user_phone: userPhone,
              is_vip: true
            }),
          });
          const data = await res.json();
          const reply = data.reply || data.response || "تحلیل حقوقی انجام شد.";
          setAiSpeech(reply);
          speakPersian(reply);
        } catch (err) {
          setCallStatus("listening");
        }
      };

      recognition.onerror = () => setCallStatus("listening");
      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartCall = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
    setIsCalling(true);
    setUserSpeech("در حال اتصال صوتی...");
    startListeningLoop();
  };

  const handleEndCall = () => {
    setIsCalling(false);
    setCallStatus("idle");
    setUserSpeech("");
    setAiSpeech("");
    if (recognitionRef.current) recognitionRef.current.abort();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  if (!isOpen) return null;

  return (
    <>
      <style>{`
        @keyframes waveform {
          0%, 100% {
            transform: scaleY(0.4);
            opacity: 0.6;
          }
          50% {
            transform: scaleY(1.3);
            opacity: 1;
          }
        }
      `}</style>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md" dir="rtl">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl relative text-center text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-5 left-5 text-slate-400 hover:text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-800 transition-colors"
        >
          ✕
        </button>

        <div className="flex items-center justify-center gap-2 mb-6">
          <span className="px-3.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded-full font-medium flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            مکالمه زنده صوتی (VIP)
          </span>
        </div>

        <div className="space-y-6 my-4">
          <div className="relative flex items-center justify-center">
            {isCalling && (
              <div className="absolute w-36 h-36 rounded-full bg-amber-500/20 animate-ping pointer-events-none" />
            )}
            
            {/* Audio Waveform Visualizer */}
            {isCalling && (callStatus === "listening" || callStatus === "speaking") && (
              <div className="absolute inset-0 flex items-center justify-center gap-1 pointer-events-none">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full ${
                      callStatus === "listening"
                        ? "bg-emerald-400 animate-[waveform_0.6s_ease-in-out_infinite]"
                        : "bg-amber-400 animate-[waveform_0.8s_ease-in-out_infinite]"
                    }`}
                    style={{
                      height: `${20 + Math.sin(i * 0.8) * 12}px`,
                      animationDelay: `${i * 0.08}s`,
                    }}
                  />
                ))}
              </div>
            )}
            
            <button
              onClick={isCalling ? handleEndCall : handleStartCall}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center text-3xl shadow-2xl transition-all ${
                isCalling
                  ? "bg-rose-500 hover:bg-rose-600 text-white scale-105 shadow-rose-500/40"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30"
              }`}
            >
              {isCalling ? "🔴" : "📞"}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-bold text-slate-200">
              {!isCalling && "برای برقراری تماس صوتی روی دکمه سبز ضربه بزنید"}
              {callStatus === "listening" && "🎙️ در حال شنیدن صدای شما..."}
              {callStatus === "processing" && "⚙️ در حال بررسی مستندات قانونی..."}
              {callStatus === "speaking" && "🔊 دستیار قاضی هوشمند در حال پاسخگویی صوتی..."}
            </p>
            {userSpeech && (
              <div className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl text-xs text-slate-300">
                <span className="text-amber-400 font-medium">صحبت شما: </span> {userSpeech}
              </div>
            )}
          </div>

          {aiSpeech && (
            <div className="bg-slate-950/90 border border-slate-800 p-4 rounded-2xl text-right text-xs text-slate-200 max-h-40 overflow-y-auto leading-relaxed border-r-2 border-r-amber-400">
              <span className="text-amber-400 font-bold block mb-1">پاسخ استنتاجی:</span>
              {aiSpeech}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

export default LiveVoiceModal;
