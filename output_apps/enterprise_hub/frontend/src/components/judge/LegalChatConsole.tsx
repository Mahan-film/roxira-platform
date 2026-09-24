'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Mic, Square, Phone } from 'lucide-react';
import { LiveVoiceModal } from '@/components/chat/live-voice-modal';

interface LegalChatConsoleProps {
  conversationId?: string;
}

export default function LegalChatConsole({ conversationId = 'default_conv' }: LegalChatConsoleProps) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([
    { role: 'assistant', content: 'سلام؛ شرح پرونده یا پرسش حقوقی خود را بنویسید یا با میکروفون بگویید.' }
  ]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const activeStreamRef = useRef<MediaStream | null>(null);
  const activeRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      // آزادسازی تمام ترک‌ها در صورت خروج از صفحه
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
        activeStreamRef.current = null;
      }
    };
  }, []);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/v1/apps/judge/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: conversationId })
      });

      if (res.ok) {
        const data = await res.json();
        const reply = data.reply || data.response || 'پاسخی دریافت نشد.';
        setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'خطا در برقراری ارتباط با مستشار قضایی.' }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'خطا در ارتباط با سرور.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.');
        return;
      }

      audioChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      activeStreamRef.current = stream;

      let mimeType = '';
      if (typeof MediaRecorder !== 'undefined') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      activeRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        // خاموش کردن قطعی سخت‌افزار میکروفون در سطح سیستم‌عامل
        if (activeStreamRef.current) {
          activeStreamRef.current.getTracks().forEach(t => t.stop());
          activeStreamRef.current = null;
        }

        const chunks = audioChunksRef.current;
        if (!chunks || chunks.length === 0) {
          setIsRecording(false);
          return;
        }

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
        if (audioBlob.size < 800) {
          setIsRecording(false);
          return;
        }

        try {
          const formData = new FormData();
          const ext = (recorder.mimeType && recorder.mimeType.includes('webm')) ? 'webm' : 'mp4';
          formData.append('file', audioBlob, `query.${ext}`);

          const response = await fetch('/api/v1/apps/judge/stt', {
            method: 'POST',
            body: formData
          });

          if (response.ok) {
            const data = await response.json();
            const transcribed = (data.text || data.transcription || '').trim();
            if (transcribed && !transcribed.includes('خطا در موتور')) {
              setInputText(prev => prev ? `${prev} ${transcribed}` : transcribed);
            }
          }
        } catch (err) {
          console.error('STT error:', err);
        } finally {
          setIsRecording(false);
          activeRecorderRef.current = null;
        }
      };

      recorder.start(200);
      setIsRecording(true);
    } catch (err) {
      console.error('Mic access error:', err);
      setIsRecording(false);
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach(t => t.stop());
        activeStreamRef.current = null;
      }
    }
  };

  const stopRecording = () => {
    if (activeRecorderRef.current && activeRecorderRef.current.state !== 'inactive') {
      try {
        activeRecorderRef.current.stop();
      } catch (e) {}
    }
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach(t => t.stop());
      activeStreamRef.current = null;
    }
    setIsRecording(false);
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto p-4 space-y-4">
      {/* لیست پیام‌ها */}
      <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl p-5 overflow-y-auto space-y-4 min-h-[380px]">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-amber-600/30 text-white rounded-br-none border border-amber-500/30' : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700'
            }`}>
              <div className="font-bold text-xs mb-1 opacity-70">
                {m.role === 'user' ? 'شما' : 'مستشار قضایی'}
              </div>
              <div>{m.content}</div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 text-amber-300 p-4 rounded-2xl text-xs animate-pulse border border-slate-700">
              در حال استخراج مواد قانونی و تدوین پاسخ...
            </div>
          </div>
        )}
      </div>

      {/* نوار وضعیت ضبط صدا */}
      {isRecording && (
        <div className="flex items-center gap-2 p-2 px-4 bg-rose-500/20 border border-rose-500/30 rounded-2xl text-rose-300 text-xs animate-pulse">
          <div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div>
          <span>در حال ضبط صدا... لطفاً صحبت فرمایید و سپس کلید توقف را لمس کنید.</span>
        </div>
      )}

      {/* ورودی متن و کنترل‌ها */}
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-2xl p-2">
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !inputText.trim()}
          className="flex items-center gap-1.5 px-5 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm rounded-xl transition cursor-pointer"
        >
          <Send className="w-4 h-4" />
          ارسال
        </button>

        <button
          onClick={() => setIsLiveVoiceOpen(true)}
          className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition cursor-pointer"
          title="مشاوره صوتی زنده"
        >
          <Phone className="w-5 h-5" />
        </button>

        {isRecording ? (
          <button
            onClick={stopRecording}
            className="p-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition cursor-pointer animate-pulse"
            title="پایان ضبط"
          >
            <Square className="w-5 h-5 fill-current" />
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition cursor-pointer"
            title="شروع ضبط صدا"
          >
            <Mic className="w-5 h-5" />
          </button>
        )}

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="پیام خود را بنویسید یا با میکروفون بگویید..."
          className="flex-1 bg-transparent px-3 text-sm text-white placeholder-slate-500 focus:outline-none"
        />
      </div>

      <LiveVoiceModal
        isOpen={isLiveVoiceOpen}
        onClose={() => setIsLiveVoiceOpen(false)}
        conversationId={conversationId}
      />
    </div>
  );
}
