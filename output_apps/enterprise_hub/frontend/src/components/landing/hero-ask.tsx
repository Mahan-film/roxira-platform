'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MAX = 2000;

/** Glass question box in the hero: submit hands the text to /chat?q=... (the chat sends it). */
export function HeroAsk() {
  const router = useRouter();
  const [text, setText] = useState('');

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const q = text.trim().slice(0, MAX);
    router.push(q ? `/chat?q=${encodeURIComponent(q)}` : '/chat');
  };

  const sideBtn =
    'gl-focus inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 transition-colors hover:border-amber-400/40 hover:text-amber-300';

  return (
    <form onSubmit={submit} className="gl-glass gl-ask rounded-[1.75rem] p-3 text-start shadow-[0_20px_60px_-30px_rgba(56,189,248,0.35)]">
      <label htmlFor="hero-q" className="sr-only">
        پرسش یا شرح پرونده
      </label>
      <textarea
        id="hero-q"
        rows={3}
        maxLength={MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e);
        }}
        placeholder="طرح پرسش یا شرح پرونده خود را بنویسید یا با میکروفون بگویید..."
        className="w-full resize-none bg-transparent px-3 pt-3 text-[15px] leading-7 text-slate-100 placeholder:text-slate-400 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pt-1">
        <Link href="/chat" className={sideBtn}>
          <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" />
          </svg>
          پیوست اسناد
        </Link>
        <Link href="/chat" className={sideBtn}>
          <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 11a7 7 0 01-14 0M12 18v4M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3z" />
          </svg>
          ضبط صوتی
        </Link>
        <span className="hidden text-[11px] text-slate-400 sm:inline">PDF، عکس، ویس و رأی دادگاه</span>
      </div>
      <button
        type="submit"
        className="gl-btn gl-focus flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-base font-black"
      >
        شروع بررسی هوشمند پرونده
        <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
    </form>
  );
}
