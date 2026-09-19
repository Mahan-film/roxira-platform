import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, Volume2, AlertCircle, RotateCcw } from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string;
  onConversationIdChange?: (id: any) => void;
  onNewMessage?: (userText: any, aiReply: any, draft?: any, prob?: any) => void;
  onTriggerLegalDraft?: (_type: any, _title: any, prompt: any) => void;
}

declare global {
  interface Window {
    __smartJudgeAudioPlayer?: HTMLAudioElement | null;
  }
}

export const unlockSafariAudio = () => {};

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ isOpen, onClose }) => {
  const [sessionState, setSessionState] = useState<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const [transcription, setTranscription] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastBase64AudioRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) cleanupSession();
    return () => cleanupSession();
  }, [isOpen]);

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

      // اجرای بومی بدون اجبار sampleRate در سافاری
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule('/worklets/pcm-processor.js');

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor', {
        processorOptions: { targetSampleRate: 16000 },
      });
      workletNodeRef.current = worklet;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      socketRef.current = ws;

      const MAX_BUFFERED = 1000000;
      worklet.port.onmessage = (event) => {
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED) {
          ws.send(event.data);
        }
      };

      source.connect(worklet);

      ws.onopen = () => {
        setSessionState('LISTENING');
      };

      ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            if (data.event === 'user_transcription') {
              setTranscription(data.text);
              setSessionState('THINKING');
            } else if (data.event === 'agent_text_response') {
              setAssistantReply(data.text);
            } else if (data.event === 'agent_audio_stream' && data.audio_data) {
              lastBase64AudioRef.current = data.audio_data;
              playAssistantSpeech(data.audio_data);
            } else if (data.event === 'error') {
              setErrorMessage(data.message);
              setSessionState('LISTENING');
            }
          }
        } catch (err) {
          console.error('WS Error:', err);
        }
      };

      ws.onerror = () => {
        setErrorMessage('خطای برقراری ارتباط زنده با سرور.');
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

  const handleCommitVoice = () => {
    if (sessionState === 'LISTENING' && socketRef.current?.readyState === WebSocket.OPEN) {
      setSessionState('THINKING');
      socketRef.current.send(JSON.stringify({ type: 'commit' }));
    }
  };

  const playAssistantSpeech = (base64Audio: string) => {
    try {
      setSessionState('SPEAKING');

      if (window.__smartJudgeAudioPlayer) {
        window.__smartJudgeAudioPlayer.pause();
        window.__smartJudgeAudioPlayer = null;
      }

      const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
      window.__smartJudgeAudioPlayer = audio;

      audio.onended = () => {
        window.__smartJudgeAudioPlayer = null;
        setSessionState('LISTENING');
      };

      audio.onerror = () => {
        window.__smartJudgeAudioPlayer = null;
        setSessionState('LISTENING');
      };

      audio.play().catch(() => {
        setSessionState('LISTENING');
      });
    } catch (e) {
      setSessionState('LISTENING');
    }
  };

  const replaySpeech = () => {
    if (lastBase64AudioRef.current) {
      playAssistantSpeech(lastBase64AudioRef.current);
    }
  };

  const cleanupSession = () => {
    if (window.__smartJudgeAudioPlayer) {
      window.__smartJudgeAudioPlayer.pause();
      window.__smartJudgeAudioPlayer = null;
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
              <h3 className="font-bold text-sm">مشاوره صوتی زنده با وکیل هوشمند</h3>
              <p className="text-[11px] text-slate-400">مبتنی بر خط لوله بلادرنگ AudioWorklet PCM16</p>
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
          <div className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-150 ${
            sessionState === 'SPEAKING' ? 'bg-amber-500/20 border-2 border-amber-400 shadow-xl shadow-amber-500/30' :
            sessionState === 'THINKING' ? 'bg-blue-500/20 border-2 border-blue-400 animate-pulse' :
            sessionState === 'LISTENING' ? 'bg-emerald-500/20 border-2 border-emerald-400 ring-4 ring-emerald-500/20' :
            'bg-slate-800 border border-slate-700'
          }`}>
            <Mic className={`w-10 h-10 ${
              sessionState === 'SPEAKING' ? 'text-amber-400' :
              sessionState === 'THINKING' ? 'text-blue-400' :
              sessionState === 'LISTENING' ? 'text-emerald-400' : 'text-slate-500'
            }`} />
          </div>

          <div className="mt-3 text-xs font-bold tracking-wide text-center">
            {sessionState === 'IDLE' && <span className="text-slate-400">جهت آغاز مکالمه کلیک فرمایید</span>}
            {sessionState === 'LISTENING' && <span className="text-emerald-400">🟢 شنونده صحبت شما هستم؛ بفرمایید...</span>}
            {sessionState === 'THINKING' && <span className="text-blue-400">🟡 در حال استخراج ادله از پایگاه قوانین...</span>}
            {sessionState === 'SPEAKING' && <span className="text-amber-400">🔊 در حال پاسخ وکیل (لطفاً تا پایان کلام گوش دهید)</span>}
          </div>
        </div>

        {sessionState === 'LISTENING' && (
          <button
            onClick={handleCommitVoice}
            className="w-full py-3.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-2xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer"
          >
            <span>پایان کلام و ارسال</span>
            <span className="text-base">🎙️</span>
          </button>
        )}

        <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/80 max-h-40 overflow-y-auto space-y-2">
          {transcription && (
            <div className="text-xs text-slate-300">
              <span className="font-bold text-slate-500">شما: </span>
              {transcription}
            </div>
          )}
          {assistantReply && (
            <div className="text-xs text-amber-200 leading-relaxed border-t border-slate-900 pt-2 flex justify-between items-start gap-2">
              <div>
                <span className="font-bold text-amber-400">پاسخ وکیل: </span>
                {assistantReply}
              </div>
              {sessionState !== 'SPEAKING' && lastBase64AudioRef.current && (
                <button
                  onClick={replaySpeech}
                  className="shrink-0 p-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-[10px] flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  پخش مجدد
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-center pt-1">
          {sessionState === 'IDLE' ? (
            <button
              onClick={startSession}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              شروع مکالمه زنده
            </button>
          ) : (
            <button
              onClick={cleanupSession}
              className="flex items-center gap-2 px-6 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold rounded-xl transition active:scale-95 cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              پایان تماس
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
