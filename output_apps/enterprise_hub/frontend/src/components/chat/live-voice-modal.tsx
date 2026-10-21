'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { liveVoiceUrl, micFailure, reportVoiceError } from '@/lib/api/judge-chat-client';
import { Phone, PhoneOff, Mic, Volume2, AlertCircle, Send } from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string;
  onConversationIdChange?: (id: string) => void;
  onNewMessage?: (userText: string, aiReply: string, draft?: string, prob?: string) => void;
  onTriggerLegalDraft?: (type: string, title: string, prompt: string) => void;
}

export const unlockSafariAudio = () => {};

const nowMs = () => Date.now();

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({ isOpen, onClose }) => {
  const { getAccessToken, expireSession } = useAuth();
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
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reconnect bookkeeping: the call survives a dropped socket (mobile networks) without
  // re-asking for the microphone; `userEndedRef` distinguishes "hang up" from "network died".
  const userEndedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectsRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const connectRef = useRef<((useToken: boolean) => void) | null>(null);

  // Playback queue: sentence-chunk (VOICE_STREAM_TTS) and Gemini-live audio
  // both arrive as several `agent_audio_stream` messages per turn. The old
  // code called currentSourceRef.current.stop() on every new message, so
  // only the LAST chunk of a multi-chunk turn was ever actually heard. Now
  // every chunk is queued and played back to back; the mic only re-arms
  // once the queue is empty AND the server has said `turn_complete`.
  const audioQueueRef = useRef<Array<{ data: string; mime?: string }>>([]);
  const isPlayingRef = useRef(false);
  const turnCompletePendingRef = useRef(false);
  // Playback goes through one gain node so barge-in can fade the voice out instead of clicking.
  const masterGainRef = useRef<GainNode | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mic VAD mode (see /worklets/pcm-processor.js):
  //   listen  = user's turn (stream + automatic end-of-turn after ~800 ms of silence)
  //   monitor = assistant speaks (nothing streamed; a high threshold detects barge-in)
  //   off     = assistant is thinking
  const setMicMode = (mode: 'listen' | 'monitor' | 'off') => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ command: 'SET_MODE', mode });
    }
  };

  const transitionState = (
    newState: 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING',
    opts?: { keepMic?: boolean },
  ) => {
    stateRef.current = newState;
    setSessionState(newState);

    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    if (rearmTimerRef.current) {
      clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    }

    // keepMic: barge-in already switched the worklet to 'listen' with the speech onset buffered.
    if (!opts?.keepMic) {
      setMicMode(newState === 'LISTENING' ? 'listen' : newState === 'SPEAKING' ? 'monitor' : 'off');
    }

    if (newState === 'THINKING' || newState === 'SPEAKING') {
      // Safety net for BOTH states: THINKING covers a stuck/slow backend
      // turn; SPEAKING covers a playback error or a dropped `turn_complete`
      // message (e.g. a raw-PCM decode failure, or a websocket hiccup)
      // that would otherwise leave the mic permanently off -- this is the
      // main "does not automatically continue listening" failure mode.
      // The server needs up to ~15 s for the LLM plus up to ~12 s for TTS; a reply read aloud
      // can run well past 15 s, so SPEAKING must not cut it off.
      const timeoutMs = newState === 'THINKING' ? 45000 : 120000;
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

  // Barge-in / hang-up: drop everything queued and fade the current clip out (~60 ms).
  const stopPlayback = () => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    turnCompletePendingRef.current = false;
    const ctx = audioContextRef.current;
    const gain = masterGainRef.current;
    const src = currentSourceRef.current;
    currentSourceRef.current = null;
    if (src) {
      src.onended = null; // a stopped clip must not pull the next one from the queue
      if (ctx && gain) {
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
        } catch { /* ignore */ }
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = setTimeout(() => {
          fadeTimerRef.current = null;
          try { src.stop(); } catch { /* already stopped */ }
          try { gain.gain.cancelScheduledValues(0); gain.gain.value = 1; } catch { /* ignore */ }
        }, 80);
      } else {
        try { src.stop(); } catch { /* already stopped */ }
      }
    }
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
        // Answer finished: re-arm listening automatically.
        if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
        rearmTimerRef.current = setTimeout(() => {
          rearmTimerRef.current = null;
          if (stateRef.current === 'SPEAKING') transitionState('LISTENING');
        }, 250);
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
        source.connect(masterGainRef.current || ctx.destination);
        if (stateRef.current === 'LISTENING' || stateRef.current === 'IDLE') return; // barge-in raced the decode
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
    // Stale chunk of an answer the user already interrupted (or a closed call): never play it.
    if (stateRef.current === 'LISTENING' || stateRef.current === 'IDLE') return;
    audioQueueRef.current.push({ data: base64Audio, mime });
    if (!isPlayingRef.current) {
      pumpAudioQueue();
    }
  };

  const triggerCommit = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN && stateRef.current === 'LISTENING') {
      // Ask the worklet to flush its buffered tail first; the commit is sent on its FLUSHED reply
      // so it cannot overtake the last PCM chunks.
      if (workletNodeRef.current) workletNodeRef.current.port.postMessage({ command: 'FLUSH' });
      else commitTurn();
    }
  };

  const commitTurn = () => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && stateRef.current === 'LISTENING') {
      ws.send(JSON.stringify({ type: 'commit' }));
      transitionState('THINKING');
    }
  };

  // The user talked over the assistant: silence it now, tell the server to stop generating, listen.
  const handleBargeIn = () => {
    if (stateRef.current !== 'SPEAKING') return;
    stopPlayback();
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'barge_in' }));
    transitionState('LISTENING', { keepMic: true });
  };

  const startSession = async () => {
    // Must run inside the click that started the call: iOS Safari only lets an
    // AudioContext make sound if it was created/resumed from a user gesture.
    if (audioContextRef.current || socketRef.current) cleanupSession(true); // drop a half-reconnected call
    userEndedRef.current = false;
    reconnectsRef.current = 0;
    sessionStartedAtRef.current = nowMs();
    try {
      setErrorMessage(null);
      setTranscription('');
      setAssistantReply('');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.WebSocket) {
        reportVoiceError('unsupported', 'live: no mediaDevices/WebSocket');
        setErrorMessage('مرورگر شما از مکالمه صوتی زنده پشتیبانی نمی‌کند. Safari یا Chrome را به‌روز کنید.');
        return;
      }

      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      if (audioCtx.state !== 'running') {
        await audioCtx.resume().catch(() => undefined);
      }
      try {
        // Silent one-sample buffer: the classic iOS "unlock" so later TTS playback is allowed.
        const silent = audioCtx.createBuffer(1, 1, 22050);
        const unlock = audioCtx.createBufferSource();
        unlock.buffer = silent;
        unlock.connect(audioCtx.destination);
        unlock.start(0);
      } catch {
        /* non-fatal */
      }

      const masterGain = audioCtx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(audioCtx.destination);
      masterGainRef.current = masterGain;

      // Echo protection starts here: the browser's echo canceller, noise suppression and AGC stay on.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      if (!audioCtx.audioWorklet) {
        throw new Error('AudioWorklet unsupported');
      }
      await audioCtx.audioWorklet.addModule(`/worklets/pcm-processor.js?v=${Date.now()}`);

      const source = audioCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(audioCtx, 'pcm-processor', {
        processorOptions: { targetSampleRate: 16000 },
      });
      workletNodeRef.current = worklet;

      worklet.port.onmessage = (event) => {
        const data = event.data;
        if (!data) return;

        if (data.event === 'BARGE_IN') {
          handleBargeIn();
          return;
        }
        if (stateRef.current !== 'LISTENING') return;
        const ws = socketRef.current;

        if (data.event === 'SPEECH_END' || data.event === 'FLUSHED') {
          // Automatic end of turn (~800 ms of silence) or the manual send button.
          commitTurn();
        } else if (data.event === 'SPEECH_DISCARDED') {
          // Too short to be speech (cough/click): make the server forget the streamed bytes.
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel' }));
        } else if (data.event === 'PCM_DATA' && data.buffer) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data.buffer);
          }
        }
      };

      source.connect(worklet);

      connectRef.current = connectSocket;
      connectSocket(true);
    } catch (err: unknown) {
      const failure = micFailure(err);
      const detail = err instanceof Error ? err.name || err.message : 'unknown';
      reportVoiceError(`live_${failure.kind}`, detail);
      setErrorMessage(failure.message);
      cleanupSession(true);
    }
  };

  // Opens (or re-opens) the websocket. `useToken=false` is the silent guest fallback used
  // when the server rejects a stale token with close code 4401.
  const connectSocket = (useToken: boolean) => {
    if (userEndedRef.current || !audioContextRef.current) return; // call was closed: never reopen
    const token = useToken ? getAccessToken() : null;
    const ws = new WebSocket(liveVoiceUrl(token));
    socketRef.current = ws;
    let opened = false;
    let serverMessage: string | null = null;
    const connectTimer = setTimeout(() => {
      if (!opened) {
        try { ws.close(); } catch { /* ignore */ }
      }
    }, 12000);

    ws.onopen = () => {
      opened = true;
      clearTimeout(connectTimer);
      reconnectsRef.current = 0;
      setErrorMessage(null);
      transitionState('LISTENING');
    };

    ws.onmessage = async (event) => {
      try {
        const res = JSON.parse(event.data);
        if (res.event === 'ping') {
          return;
        } else if (res.event === 'user_transcription' || res.type === 'TRANSCRIPT') {
          setErrorMessage(null);
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
          if (stateRef.current !== 'THINKING' && stateRef.current !== 'SPEAKING') {
            // Stale event of an interrupted turn: the mic is already live, do not reset the VAD.
          } else if (isPlayingRef.current || audioQueueRef.current.length > 0) {
            turnCompletePendingRef.current = true;
          } else {
            transitionState('LISTENING');
          }
        } else if (res.event === 'notice' || res.type === 'NOTICE') {
          // Non-fatal (no speech heard, TTS down...): show it, keep the call.
          setErrorMessage(res.message || null);
        } else if (res.event === 'error' || res.type === 'ERROR') {
          serverMessage = res.message || 'خطای سرور.';
          setErrorMessage(serverMessage);
        }
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onerror = () => {
      // onclose always follows; it decides between reconnect and giving up.
      reportVoiceError('ws_error', opened ? 'error after open' : 'error before open');
    };

    ws.onclose = (ev) => {
      clearTimeout(connectTimer);
      if (socketRef.current !== ws) return; // superseded or already cleaned up
      socketRef.current = null;
      if (userEndedRef.current) return;

      if (ev.code === 4401) {
        // Expired token: ask to log in again, and still connect as guest.
        reportVoiceError('ws_4401', 'stale token, retrying as guest');
        if (useToken) {
          expireSession();
          connectSocket(false);
          return;
        }
      }
      if (ev.code === 4429) {
        reportVoiceError('ws_4429', 'rate limited');
        setErrorMessage(serverMessage || 'تعداد درخواست‌های صوتی بیش از حد مجاز است. بعداً دوباره تلاش کنید.');
        cleanupSession(true);
        return;
      }

      reportVoiceError('ws_closed', `code=${ev.code} opened=${opened} after_ms=${nowMs() - sessionStartedAtRef.current}`);
      if (reconnectsRef.current < 3 && navigator.onLine !== false) {
        reconnectsRef.current += 1;
        const attempt = reconnectsRef.current;
        setErrorMessage('اتصال قطع شد؛ در حال اتصال دوباره…');
        transitionState('IDLE');
        audioQueueRef.current = [];
        isPlayingRef.current = false;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!userEndedRef.current && audioContextRef.current) connectRef.current?.(useToken);
        }, 800 * attempt);
        return;
      }
      setErrorMessage(serverMessage || 'ارتباط صوتی قطع شد. اینترنت را بررسی کنید و دوباره تماس بگیرید.');
      cleanupSession(true);
    };
  };

  const cleanupSession = (fromError = false) => {
    if (!fromError) userEndedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    connectRef.current = null;
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    if (rearmTimerRef.current) {
      clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setMicMode('off');
    stateRef.current = 'IDLE';
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    turnCompletePendingRef.current = false;
    if (currentSourceRef.current) {
      currentSourceRef.current.onended = null;
      try { currentSourceRef.current.stop(); } catch (e) {}
      currentSourceRef.current = null;
    }
    masterGainRef.current = null;
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
      const ws = socketRef.current;
      socketRef.current = null; // detach first so onclose does not trigger a reconnect
      try { ws.close(); } catch (e) {}
    }
    setSessionState('IDLE');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#05080f]/85 backdrop-blur-md">
      <div className="relative w-full max-w-md p-6 bg-[#0a0f1a] border border-white/10 rounded-3xl shadow-2xl text-white space-y-5">
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
          <button onClick={() => { cleanupSession(); onClose(); }} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer">
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
            sessionState === 'THINKING' ? 'bg-sky-500/20 border-2 border-sky-400 animate-pulse' :
            sessionState === 'LISTENING' ? 'bg-emerald-500/20 border-2 border-emerald-400 ring-8 ring-emerald-500/10 scale-105' :
            'bg-slate-800 border border-slate-700'
          }`}>
            <Mic className={`w-10 h-10 ${
              sessionState === 'SPEAKING' ? 'text-amber-400' :
              sessionState === 'THINKING' ? 'text-sky-400' :
              sessionState === 'LISTENING' ? 'text-emerald-400' : 'text-slate-500'
            }`} />
          </div>

          <div className="mt-4 text-xs font-bold tracking-wide text-center">
            {sessionState === 'IDLE' && <span className="text-slate-400">جهت آغاز تماس صوتی کلیک فرمایید</span>}
            {sessionState === 'LISTENING' && <span className="text-emerald-400">در حال گوش دادن…</span>}
            {sessionState === 'THINKING' && <span className="text-sky-400">در حال فکر کردن…</span>}
            {sessionState === 'SPEAKING' && <span className="text-amber-400">در حال پاسخ…</span>}
          </div>

          {sessionState === 'SPEAKING' && (
            <p className="mt-2 text-[11px] text-slate-400">برای قطع پاسخ، کافی است شروع به صحبت کنید.</p>
          )}
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
              className="flex items-center gap-2 px-8 py-3 bg-[#fbbf24] hover:bg-[#f59e0b] text-[#0b1020] font-bold focus-visible:outline-2 focus-visible:outline-sky-400 rounded-2xl shadow-lg transition active:scale-95 cursor-pointer"
            >
              <Phone className="w-5 h-5" />
              شروع مکالمه زنده
            </button>
          ) : (
            <button
              onClick={() => cleanupSession()}
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
