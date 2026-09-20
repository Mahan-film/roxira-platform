'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, Volume2, AlertCircle, Send } from 'lucide-react';

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
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sessionStateRef = useRef<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');

  const updateState = (st: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING') => {
    sessionStateRef.current = st;
    setSessionState(st);
  };

  useEffect(() => {
    if (!isOpen) cleanupSession();
    return () => cleanupSession();
  }, [isOpen]);

  const playAudio = async (base64Audio: string) => {
    try {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      if (currentSourceRef.current) {
        try { currentSourceRef.current.stop(); } catch (e) {}
        currentSourceRef.current = null;
      }

      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
        ctx.decodeAudioData(bytes.buffer.slice(0), resolve, reject);
      });

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      currentSourceRef.current = source;

      updateState('SPEAKING');

      source.onended = () => {
        currentSourceRef.current = null;
        updateState('LISTENING');
      };

      source.start(0);
    } catch (err) {
      console.error('Audio playback error:', err);
      // فال‌بک با تگ HTML5 صوتی در صورت هرگونه محدودیت بافر
      try {
        const fallbackAudio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        fallbackAudio.onended = () => updateState('LISTENING');
        await fallbackAudio.play();
        updateState('SPEAKING');
      } catch (e) {
        updateState('LISTENING');
      }
    }
  };

  const triggerCommit = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'commit' }));
      updateState('THINKING');
    }
  };

  const startSession = async () => {
    try {
      setErrorMessage(null);
      setTranscription('');
      setAssistantReply('');

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      await audioCtx.audioWorklet.addModule(`/worklets/pcm-processor.js?v=${Date.now()}`);

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

        // قطع کلام (Barge-in) فقط و فقط در صورتی ارسال می‌شود که هوش مصنوعی در حال صحبت باشد
        if (data.event === 'SPEECH_START') {
          if (sessionStateRef.current === 'SPEAKING') {
            if (currentSourceRef.current) {
              try { currentSourceRef.current.stop(); } catch (e) {}
              currentSourceRef.current = null;
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'INTERRUPT' }));
            }
            updateState('LISTENING');
          }
        }

        // پایان خودکار کلام بر اساس سکوت در حالت شنیدن
        else if (data.event === 'SPEECH_END') {
          if (sessionStateRef.current === 'LISTENING') {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'commit' }));
              updateState('THINKING');
            }
          }
        }

        // ارسال فریم‌های صوتی
        else if (data.event === 'PCM_DATA' && data.buffer) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data.buffer);
          }
        }
      };

      source.connect(worklet);

      ws.onopen = () => {
        updateState('LISTENING');
      };

      ws.onmessage = async (event) => {
        try {
          const res = JSON.parse(event.data);
          
          if (res.event === 'user_transcription' || res.type === 'TRANSCRIPT') {
            setTranscription(res.text || '');
            updateState('THINKING');
          } else if (res.event === 'agent_text_response' || res.type === 'ANSWER_TEXT') {
            setAssistantReply(res.text || '');
          } else if (res.event === 'agent_audio_stream' || res.type === 'AUDIO_STREAM') {
            const b64 = res.audio_data;
            if (b64) {
              await playAudio(b64);
            }
          } else if (res.type === 'INTERRUPT_ACK') {
            updateState('LISTENING');
          }
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
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
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop(); } catch (e) {}
      currentSourceRef.current = null;
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
    updateState('IDLE');
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
              <p className="text-[11px] text-slate-400">متصل به پایگاه داده آرای وحدت رویه</p>
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

        <div className="flex flex-col items-center justify-center py-4">
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
            {sessionState === 'THINKING' && <span className="text-blue-400">🟡 در حال استخراج ادله و آماده‌سازی پاسخ...</span>}
            {sessionState === 'SPEAKING' && <span className="text-amber-400">🔊 در حال صحبت وکیل (برای قطع صحبت، سخن بگویید)</span>}
          </div>

          {sessionState === 'LISTENING' && (
            <button
              onClick={triggerCommit}
              className="mt-3 flex items-center gap-2 px-5 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/40 text-emerald-300 text-xs font-bold rounded-xl transition active:scale-95 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              ارسال فوری کلام (بدون مکث)
            </button>
          )}
        </div>

        <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/80 max-h-40 overflow-y-auto space-y-2">
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

        <div className="flex justify-center pt-1">
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
              className="flex items-center gap-2 px-8 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold rounded-2xl transition active:scale-95 cursor-pointer"
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

export default LiveVoiceModal;
