import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, Volume2, AlertCircle } from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string;
  onConversationIdChange?: (id: any) => void;
  onNewMessage?: (userText: any, aiReply: any, draft?: any, prob?: any) => void;
  onTriggerLegalDraft?: (_type: any, _title: any, prompt: any) => void;
}

export const unlockSafariAudio = () => {};

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ isOpen, onClose }) => {
  const [sessionState, setSessionState] = useState<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const [transcription, setTranscription] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) cleanupSession();
    return () => cleanupSession();
  }, [isOpen]);

  // پخش صدا از طریق AudioContext جهت عبور از سد Autoplay سافاری
  const playAudioThroughContext = async (audioDataB64: string) => {
    try {
      if (!audioContextRef.current) return;
      setSessionState('SPEAKING');

      // توقف هرگونه صدای در حال پخش قبلی
      if (currentSourceNodeRef.current) {
        try { currentSourceNodeRef.current.stop(); } catch (e) {}
        currentSourceNodeRef.current = null;
      }

      // تبدیل base64 به آرایه‌بایت
      const binaryString = window.atob(audioDataB64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // دیکود مستقیم و پخش در لایه سخت‌افزاری مرورگر
      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      currentSourceNodeRef.current = source;

      source.onended = () => {
        currentSourceNodeRef.current = null;
        setSessionState('LISTENING');
      };

      source.start(0);
    } catch (err) {
      console.error('Audio play error:', err);
      setSessionState('LISTENING');
    }
  };

  const startSession = async () => {
    try {
      setErrorMessage(null);
      setTranscription('');
      setAssistantReply('');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      // باز کردن قفل صوتی سافاری با پخش یک بافر کوتاه بی‌صدا
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      const silentBuffer = audioCtx.createBuffer(1, 1, 22050);
      const silentSource = audioCtx.createBufferSource();
      silentSource.buffer = silentBuffer;
      silentSource.connect(audioCtx.destination);
      silentSource.start(0);

      await audioCtx.audioWorklet.addModule('/worklets/pcm-processor.js');

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor', {
        processorOptions: { targetSampleRate: 16000 },
      });
      workletNodeRef.current = worklet;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice?tier=VIP&phone=09129367796`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      worklet.port.onmessage = (event) => {
        const data = event.data;
        if (!data) return;

        // تشخیص شروع کلام کاربر -> قطع آنی صدای وکیل (Barge-in)
        if (data.event === 'SPEECH_START') {
          if (currentSourceNodeRef.current) {
            try { currentSourceNodeRef.current.stop(); } catch (e) {}
            currentSourceNodeRef.current = null;
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'INTERRUPT' }));
          }
          setSessionState('LISTENING');
        }

        // تشخیص پایان خودکار کلام کاربر بر اساس سکوت (Hands-Free Commit)
        else if (data.event === 'SPEECH_END') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'COMMIT' }));
            setSessionState('THINKING');
          }
        }

        // ارسال فریم‌های باینری صدا
        else if (data.event === 'PCM_DATA' && data.buffer) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data.buffer);
          }
        }
      };

      source.connect(worklet);

      ws.onopen = () => {
        setSessionState('LISTENING');
      };

      ws.onmessage = (event) => {
        try {
          const res = JSON.parse(event.data);
          if (res.type === 'TRANSCRIPT' || res.event === 'user_transcription') {
            setTranscription(res.text);
            setSessionState('THINKING');
          } else if (res.type === 'ANSWER_TEXT' || res.event === 'agent_text_response') {
            setAssistantReply(res.text);
          } else if (res.type === 'AUDIO_STREAM' || res.event === 'agent_audio_stream') {
            const audioData = res.audio_data;
            if (audioData) {
              playAudioThroughContext(audioData);
            }
          } else if (res.type === 'INTERRUPT_ACK') {
            setSessionState('LISTENING');
          }
        } catch (e) {}
      };

      ws.onerror = () => {
        setErrorMessage('خطای برقراری ارتباط وب‌سوکت.');
        cleanupSession();
      };

      ws.onclose = () => {
        cleanupSession();
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'دسترسی به میکروفون میسر نشد.';
      setErrorMessage(msg);
      cleanupSession();
    }
  };

  const cleanupSession = () => {
    if (currentSourceNodeRef.current) {
      try { currentSourceNodeRef.current.stop(); } catch (e) {}
      currentSourceNodeRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch(e){}
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setSessionState('IDLE');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="relative w-full max-w-md p-6 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-white space-y-5">
        <div className="flex justify-between items-center border-b border-slate-800 pb-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl transition-all ${sessionState === 'SPEAKING' ? 'bg-amber-500/20 text-amber-400 ring-2 ring-amber-500/40 animate-pulse' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {sessionState === 'SPEAKING' ? <Volume2 className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </div>
            <div>
              <h3 className="font-bold text-sm">مشاوره صوتی زنده (گفتگوی پیوسته)</h3>
              <p className="text-[11px] text-slate-400">تشخیص هوشمند سکوت و پخش خودکار</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer">
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col items-center justify-center py-6">
          <div className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-200 ${
            sessionState === 'SPEAKING' ? 'bg-amber-500/20 border-2 border-amber-400 shadow-xl shadow-amber-500/40 animate-pulse' :
            sessionState === 'THINKING' ? 'bg-blue-500/20 border-2 border-blue-400 animate-pulse' :
            sessionState === 'LISTENING' ? 'bg-emerald-500/20 border-2 border-emerald-400 ring-8 ring-emerald-500/10 scale-105' :
            'bg-slate-800 border border-slate-700'
          }`}>
            <Mic className={`w-10 h-10 ${
              sessionState === 'SPEAKING' ? 'text-amber-400' :
              sessionState === 'THINKING' ? 'text-blue-400' :
              sessionState === 'LISTENING' ? 'text-emerald-400' : 'text-slate-500'
            }`} />
          </div>

          <div className="mt-4 text-xs font-bold tracking-wide text-center">
            {sessionState === 'IDLE' && <span className="text-slate-400">جهت آغاز تماس صوتی کلیک فرمایید</span>}
            {sessionState === 'LISTENING' && <span className="text-emerald-400">🟢 در حال شنیدن صدای شما (صحبت کنید و مکث فرمایید)...</span>}
            {sessionState === 'THINKING' && <span className="text-blue-400">🟡 در حال استخراج قوانین و آماده‌سازی پاسخ...</span>}
            {sessionState === 'SPEAKING' && <span className="text-amber-400">🔊 در حال صحبت وکیل (برای قطع صحبت، سخن بگویید)</span>}
          </div>
        </div>

        <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/80 max-h-44 overflow-y-auto space-y-2">
          {transcription && (
            <div className="text-xs text-slate-300">
              <span className="font-bold text-slate-500">شما: </span>
              {transcription}
            </div>
          )}
          {assistantReply && (
            <div className="text-xs text-amber-200 leading-relaxed border-t border-slate-900 pt-2">
              <span className="font-bold text-amber-400">پاسخ وکیل: </span>
              {assistantReply}
            </div>
          )}
        </div>

        <div className="flex justify-center pt-2">
          {sessionState === 'IDLE' ? (
            <button
              onClick={startSession}
              className="flex items-center gap-2 px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-2xl shadow-lg transition active:scale-95 cursor-pointer"
            >
              <Phone className="w-5 h-5" />
              شروع مکالمه زنده
            </button>
          ) : (
            <button
              onClick={cleanupSession}
              className="flex items-center gap-2 px-8 py-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold rounded-2xl transition active:scale-95 cursor-pointer"
            >
              <PhoneOff className="w-5 h-5" />
              پایان تماس
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
