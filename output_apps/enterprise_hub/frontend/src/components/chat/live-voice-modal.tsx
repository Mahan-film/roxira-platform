import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, AlertCircle } from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ isOpen, onClose }) => {
  const [sessionState, setSessionState] = useState<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const [transcription, setTranscription] = useState<string>('');
  const [assistantReply, setAssistantReply] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isOpen) {
      cleanupSession();
    }
  }, [isOpen]);

  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  const startSession = async () => {
    try {
      setErrorMessage(null);
      initAudioContext();

      // اتصال به وب‌سوکت دوطرفه سامانه
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v1/apps/judge/live-voice`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = async () => {
        setSessionState('LISTENING');
        await startRecording();
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.event === 'user_transcription') {
            setTranscription(data.text);
            setSessionState('THINKING');
          } else if (data.event === 'agent_text_response') {
            setAssistantReply(data.text);
          } else if (data.event === 'agent_audio_stream' && data.audio_data) {
            await playAudioResponse(data.audio_data);
          } else if (data.event === 'error') {
            setErrorMessage(data.message);
            setSessionState('LISTENING');
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onerror = () => {
        setErrorMessage('خطا در برقراری ارتباط زنده با سرور.');
        cleanupSession();
      };

      ws.onclose = () => {
        cleanupSession();
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'خطای دسترسی به میکروفون';
      setErrorMessage(msg);
      cleanupSession();
    }
  };

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = recorder;

    let audioChunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    recorder.onstop = async () => {
      if (audioChunks.length > 0 && socketRef.current?.readyState === WebSocket.OPEN) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Data = (reader.result as string).split(',')[1];
          socketRef.current?.send(JSON.stringify({
            type: 'audio_input',
            audio_data: base64Data,
            mime: 'audio/webm',
          }));
          setSessionState('THINKING');
        };
      }
      audioChunks = [];
    };

    recorder.start(1000);
  };

  const playAudioResponse = async (base64Audio: string) => {
    try {
      // توقف موقت ضبط برای ممانعت از ارسال صدای اسپیکر به میکروفون
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setSessionState('SPEAKING');

      initAudioContext();
      const binaryString = window.atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      if (audioContextRef.current) {
        const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer.slice(0));
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);

        source.onended = async () => {
          // پس از پایان ادای سخن وکیل، گوش دادن فعال می‌شود
          setSessionState('LISTENING');
          await startRecording();
        };

        source.start(0);
      }
    } catch (e) {
      console.error('Audio playback error:', e);
      setSessionState('LISTENING');
      await startRecording();
    }
  };

  const cleanupSession = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (socketRef.current) {
      socketRef.current.close();
    }
    setSessionState('IDLE');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-lg p-6 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl text-white space-y-6">
        <div className="flex justify-between items-center border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-2xl ${sessionState === 'SPEAKING' ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-emerald-500/20 text-emerald-400'}`}>
              {sessionState === 'SPEAKING' ? <Volume2 className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            </div>
            <div>
              <h3 className="font-bold text-base">مشاوره صوتی زنده با وکیل هوشمند</h3>
              <p className="text-xs text-slate-400">متصل به پایگاه آراء وحدت رویه و قوانین مدنی</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition">
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800/80 min-h-[140px] space-y-3">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase">پرسش شما:</span>
            <p className="text-sm text-slate-200 mt-1">{transcription || 'در انتظار صحبت شما...'}</p>
          </div>
          <div className="border-t border-slate-900 pt-2">
            <span className="text-[11px] font-bold text-amber-500 uppercase">پاسخ مستند وکیل:</span>
            <p className="text-sm text-amber-300 mt-1 leading-relaxed">{assistantReply || '...'}</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center pt-2 space-y-3">
          <div className="text-xs font-mono font-bold text-slate-400">
            {sessionState === 'IDLE' && 'جهت شروع مکالمه کلیک کنید'}
            {sessionState === 'LISTENING' && '🟢 در حال شنیدن صدای شما...'}
            {sessionState === 'THINKING' && '🟡 در حال استخراج ادله از پایگاه قوانین...'}
            {sessionState === 'SPEAKING' && '🔊 در حال پاسخ صوتی وکیل...'}
          </div>

          {sessionState === 'IDLE' ? (
            <button
              onClick={startSession}
              className="flex items-center gap-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-2xl shadow-lg shadow-emerald-500/20 transition active:scale-95"
            >
              <Phone className="w-5 h-5" />
              شروع مکالمه زنده
            </button>
          ) : (
            <button
              onClick={cleanupSession}
              className="flex items-center gap-2 px-6 py-3 bg-rose-500 hover:bg-rose-400 text-white font-bold rounded-2xl shadow-lg shadow-rose-500/20 transition active:scale-95"
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
