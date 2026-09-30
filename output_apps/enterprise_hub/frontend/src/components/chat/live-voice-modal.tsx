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
  const stateRef = useRef<'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'>('IDLE');
  const watchdogTimerRef = useRef<any>(null);

  // Playback queue: sentence-chunk (VOICE_STREAM_TTS) and Gemini-live audio
  // both arrive as several `agent_audio_stream` messages per turn. The old
  // code called currentSourceRef.current.stop() on every new message, so
  // only the LAST chunk of a multi-chunk turn was ever actually heard. Now
  // every chunk is queued and played back to back; the mic only re-arms
  // once the queue is empty AND the server has said `turn_complete`.
  const audioQueueRef = useRef<Array<{ data: string; mime?: string }>>([]);
  const isPlayingRef = useRef(false);
  const turnCompletePendingRef = useRef(false);

  const setListenMode = (isListening: boolean) => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({
        command: 'SET_LISTEN',
        listening: isListening,
      });
    }
  };

  const transitionState = (newState: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING') => {
    stateRef.current = newState;
    setSessionState(newState);

    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }

    if (newState === 'LISTENING') {
      setListenMode(true);
    } else {
      setListenMode(false);
    }

    if (newState === 'THINKING' || newState === 'SPEAKING') {
      // Safety net for BOTH states: THINKING covers a stuck/slow backend
      // turn; SPEAKING covers a playback error or a dropped `turn_complete`
      // message (e.g. a raw-PCM decode failure, or a websocket hiccup)
      // that would otherwise leave the mic permanently off -- this is the
      // main "does not automatically continue listening" failure mode.
      const timeoutMs = newState === 'THINKING' ? 9000 : 15000;
      watchdogTimerRef.current = setTimeout(() => {
        if (stateRef.current === newState) {
          audioQueueRef.current = [];
          isPlayingRef.current = false;
          transitionState('LISTENING');
        }
      }, timeoutMs);
    }
  };

  useEffect(() => {
    if (!isOpen) cleanupSession();
    return () => cleanupSession();
  }, [isOpen]);

  const base64ToBytes = (base64Audio: string): Uint8Array => {
    const binaryString = window.atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  // The two backends this modal talks to (smartjudge_live_voice.py's
  // edge-tts cascade, or VOICE_REALTIME_PROVIDER=gemini's raw PCM stream,
  // docs/W20_realtime_voice.md) send audio in different containers.
  // decodeAudioData() only understands an encoded container (mp3/wav/ogg
  // with headers) -- calling it on headerless raw PCM silently rejects the
  // promise, which is one of the two root causes of "no audio at all"
  // fixed in W20. Raw PCM is now built into an AudioBuffer by hand instead.
  const decodeToBuffer = async (
    ctx: AudioContext,
    base64Audio: string,
    mime?: string,
  ): Promise<AudioBuffer> => {
    const bytes = base64ToBytes(base64Audio);

    const pcmMatch = /audio\/pcm;?\s*rate=(\d+)/i.exec(mime || '');
    if (pcmMatch) {
      const sampleRate = parseInt(pcmMatch[1], 10) || 24000;
      const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      const buffer = ctx.createBuffer(1, pcm16.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm16.length; i++) {
        channel[i] = pcm16[i] / 0x8000;
      }
      return buffer;
    }

    // Encoded clip (edge-tts mp3 chunks concatenated) -- the original path.
    return await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer, resolve, reject);
    });
  };

  const pumpAudioQueue = () => {
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const next = audioQueueRef.current.shift();
    if (!next) {
      isPlayingRef.current = false;
      currentSourceRef.current = null;
      if (turnCompletePendingRef.current) {
        turnCompletePendingRef.current = false;
        setTimeout(() => transitionState('LISTENING'), 250);
      }
      return;
    }

    isPlayingRef.current = true;
    if (stateRef.current !== 'SPEAKING') {
      transitionState('SPEAKING');
    }

    (async () => {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const audioBuffer = await decodeToBuffer(ctx, next.data, next.mime);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSourceRef.current = source;
        source.onended = () => {
          pumpAudioQueue();
        };
        source.start(0);
      } catch (err) {
        console.error('Audio playback error:', err);
        // Skip the bad chunk instead of stalling the whole queue/turn.
        pumpAudioQueue();
      }
    })();
  };

  const enqueueAudio = (base64Audio: string, mime?: string) => {
    if (!base64Audio) return;
    audioQueueRef.current.push({ data: base64Audio, mime });
    if (!isPlayingRef.current) {
      pumpAudioQueue();
    }
  };

  const triggerCommit = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && stateRef.current === 'LISTENING') {
      socketRef.current.send(JSON.stringify({ type: 'commit' }));
      transitionState('THINKING');
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

        if (stateRef.current !== 'LISTENING') return;

        if (data.event === 'SPEECH_END') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'commit' }));
            transitionState('THINKING');
          }
        } else if (data.event === 'PCM_DATA' && data.buffer) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data.buffer);
          }
        }
      };

      source.connect(worklet);

      ws.onopen = () => {
        transitionState('LISTENING');
      };

      ws.onmessage = async (event) => {
        try {
          const res = JSON.parse(event.data);
          if (res.event === 'user_transcription' || res.type === 'TRANSCRIPT') {
            setTranscription(res.text || '');
          } else if (res.event === 'agent_text_response' || res.type === 'ANSWER_TEXT') {
            setAssistantReply(res.text || '');
          } else if (res.event === 'agent_audio_stream' || res.type === 'AUDIO_STREAM') {
            const b64 = res.audio_data;
            if (b64) {
              enqueueAudio(b64, res.mime);
            }
          } else if (res.event === 'turn_complete') {
            // Don't cut playback short: if audio is still queued/playing
            // (streaming TTS sentence chunks, or a multi-chunk Gemini
            // reply), wait for the queue to actually drain before re-
            // arming the mic -- pumpAudioQueue() does that once
            // turnCompletePendingRef is set. If nothing is playing (e.g.
            // TTS failed and produced no audio at all), go straight back
            // to LISTENING so the conversation keeps moving.
            if (isPlayingRef.current || audioQueueRef.current.length > 0) {
              turnCompletePendingRef.current = true;
            } else {
              transitionState('LISTENING');
            }
          } else if (res.event === 'error' || res.type === 'ERROR') {
            setErrorMessage(res.message || 'خطای سرور.');
          }
        } catch (e) {
          console.error('WS parse error:', e);
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
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    setListenMode(false);
    stateRef.current = 'IDLE';
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    turnCompletePendingRef.current = false;
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
              <p className="text-[11px] text-slate-400">متصل به قوانین، آراء وحدت رویه و مقررات هیئت وزیران</p>
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
            {sessionState === 'THINKING' && <span className="text-blue-400">🟡 در حال استخراج ادله، آراء و مصوبات دولت...</span>}
            {sessionState === 'SPEAKING' && <span className="text-amber-400">🔊 در حال بیان تحلیل مستشار (لطفاً گوش فرادهید)...</span>}
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
              <span className="font-bold text-amber-400">پاسخ مستشار: </span>
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
