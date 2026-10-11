"use client";
import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import { Lightbulb, X } from "lucide-react";

const TIPS_KEY = "ghazi_chat_tips_v1";
const MIC_HINT_KEY = "ghazi_mic_hint_v1";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false; // storage blocked (private mode): treat as not seen
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* storage blocked: the hint simply shows again next visit */
  }
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
// Server render and first hydration treat every hint as already seen (nothing flashes in).
const seenOnServer = () => true;

function useSeenFlag(key: string): [boolean, () => void] {
  const seen = useSyncExternalStore(subscribe, () => readFlag(key), seenOnServer);
  const markSeen = () => {
    writeFlag(key);
    // storage may be blocked: the in-memory set keeps it hidden for this page view
    memorySeen.add(key);
    listeners.forEach((l) => l());
  };
  return [seen || memorySeen.has(key), markSeen];
}
const memorySeen = new Set<string>();

/** First-visit tip card. Dismissal is remembered in localStorage. */
export function ChatTipCard() {
  const [seen, dismiss] = useSeenFlag(TIPS_KEY);
  if (seen) return null;

  return (
    <section
      className="relative rounded-[14px] p-4 pe-11"
      style={{ background: "var(--ap-surface-2)", border: "1px solid var(--ap-line)" }}
      aria-label="نکته‌های شروع"
    >
      <button
        type="button"
        onClick={dismiss}
        className="ap-iconbtn absolute end-1.5 top-1.5"
        aria-label="بستن نکته‌ها"
        title="بستن"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Lightbulb className="size-4 ap-chip-icon" aria-hidden="true" />
        <span>سه نکته برای شروع</span>
      </h2>
      <ol className="list-decimal space-y-1 ps-5 text-sm leading-7">
        <li>ماجرا را با تاریخ، شهر و خواسته‌تان بنویسید؛ هر چه دقیق‌تر، پاسخ کاربردی‌تر.</li>
        <li>به‌جای تایپ می‌توانید با دکمه میکروفون بگویید؛ متن پیش از ارسال قابل ویرایش است.</li>
        <li>پاسخ‌ها مشاوره رسمی نیستند؛ پیش از اقدام با وکیل بررسی کنید.</li>
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href="/guide" className="ap-chip ap-chip-link">
          راهنمای کامل
        </Link>
        <button type="button" onClick={dismiss} className="ap-chip">
          متوجه شدم
        </button>
      </div>
    </section>
  );
}

/** Contextual hint under the mic button; disappears after the first use. */
export function useMicHint() {
  const [seen, markUsed] = useSeenFlag(MIC_HINT_KEY);
  return { show: !seen, markUsed };
}

export function MicHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <p className="ap-notice flex items-start justify-between gap-2" role="note">
      <span>
        میکروفون: بزنید و پرسش را بگویید (تا ۲ دقیقه)؛ دوباره بزنید تا متن در کادر بنشیند. صدای واضح و محیط ساکت، دقت را بالا می‌برد.{" "}
        <Link href="/guide#voice" className="ap-link underline">
          راهنما
        </Link>
      </span>
      <button type="button" onClick={onDismiss} className="ap-link shrink-0 underline">
        فهمیدم
      </button>
    </p>
  );
}
