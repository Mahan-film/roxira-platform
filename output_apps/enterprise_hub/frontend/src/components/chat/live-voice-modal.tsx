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
    __smartJudgeAudioContext?: AudioContext | null;
  }
}

// تابع صادراتی مورد نیاز chat-shell.tsx جهت فعال‌سازی پیش‌دستانه وب‌اودیو در سافاری
export const unlockSafariAudio = () => {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!window.__smartJudgeAudioContext) {
      window.__smartJudgeAudioContext = new AudioCtx();
    }
    if (window.__smartJudgeAudioContext.state === 'suspended') {
      window.__smartJudgeAudioContext.resume();
    }
  } catch (e) {
    console.warn('Audio unlock warning:', e);
  }
};

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ isOpen, onClose }) => {
  const [sessionState, setSessionState] = useState<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const [transcription, setTranscription] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const lastBase64AudioRef = useRef<string | null>(null);
  const activeMimeTypeRef = useRef<string>('audio/webm');

  useEffect(() => {
    if (!isOpen) {
      cleanupSession();
    }
    return () => {
      cleanupSession();
    };
  }, [isOpen]);

  const detectSupportedMimeType = (): string => {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  };

  const startVisualizer = (stream: MediaStream) => {
    try {
      unlockSafariAudio();
      const ctx = window.__smartJudgeAudioContext || new AudioContext();
      window.__smartJudgeAudioContext = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
          const avg = sum / bufferLength;
          setAudioLevel(Math.min(100, Math.round(avg * 1.6)));
        }
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };
      updateMeter();
    } catch (e) {
      console.warn('Visualizer warning:', e);
    }
  };

  const startSession = async () => {
    try {
      setErrorMessage(null);
      setTranscription('');
      setAssistantReply('');
      unlockSafariAudio();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      startVisualizer(stream);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        startFreshRecording();
      };

      ws.onmessage = (event) => {
        try {
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
            resumeListening();
          }
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onerror = () => {
        setErrorMessage('ارتباط با سرور صوتی برقرار نشد.');
        cleanupSession();
      };

      ws.onclose = () => {
        cleanupSession();
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'دسترسی به میکروفون میسر نیست.';
      setErrorMessage(msg);
      cleanupSession();
    }
  };

  const startFreshRecording = () => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });

    audioChunksRef.current = [];
    const mime = detectSupportedMimeType();
    activeMimeTypeRef.current = mime || 'audio/webm';

    try {
      const options = mime ? { mimeType: mime } : undefined;
      const recorder = new MediaRecorder(streamRef.current, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (audioChunksRef.current.length > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
          const blob = new Blob(audioChunksRef.current, { type: activeMimeTypeRef.current });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            socketRef.current?.send(JSON.stringify({
              type: 'audio_input',
              audio_data: base64,
              mime: activeMimeTypeRef.current,
            }));
          };
        }
        audioChunksRef.current = [];
      };

      recorder.start(400);
      setSessionState('LISTENING');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'خطای رکوردر';
      setErrorMessage(msg);
    }
  };

  const handleCommitVoice = () => {
    if (sessionState === 'LISTENING') {
      setSessionState('THINKING');
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
      }
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

      // تا پایان جمله میکروفون باز نمی‌شود
      audio.onended = () => {
        window.__smartJudgeAudioPlayer = null;
        resumeListening();
      };

      audio.onerror = () => {
        window.__smartJudgeAudioPlayer = null;
        resumeListening();
      };

      audio.play().catch(() => {
        resumeListening();
      });
    } catch (e) {
      resumeListening();
    }
  };

  const resumeListening = () => {
    setSessionState('LISTENING');
    startFreshRecording();
  };

  const replaySpeech = () => {
    if (lastBase64AudioRef.current) {
      playAssistantSpeech(lastBase64AudioRef.current);
    }
  };

  const cleanupSession = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (window.__smartJudgeAudioPlayer) {
      window.__smartJudgeAudioPlayer.pause();
      window.__smartJudgeAudioPlayer = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch(e){}
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
    setAudioLevel(0);
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
              <p className="text-[11px] text-slate-400">متصل به پایگاه آراء وحدت رویه و قوانین مدنی</p>
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
          <div 
            style={{ transform: sessionState === 'LISTENING' ? `scale(${1 + audioLevel * 0.003})` : 'scale(1)' }}
            className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-150 ${
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

          {sessionState === 'LISTENING' && (
            <div className="flex items-center gap-1.5 mt-3 h-5">
              {[0.4, 0.8, 1.2, 0.7, 1.4, 0.9, 0.5].map((factor, i) => (
                <div 
                  key={i} 
                  style={{ height: `${Math.max(4, Math.min(20, audioLevel * factor * 0.4))}px` }}
                  className="w-1.5 bg-emerald-400 rounded-full transition-all duration-75"
                />
              ))}
            </div>
          )}

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
