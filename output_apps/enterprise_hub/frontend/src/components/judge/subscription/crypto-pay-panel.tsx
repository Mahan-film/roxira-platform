"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, ShieldAlert } from "lucide-react";

import type { BackendPlanType } from "./types";

/**
 * Optional USDT (TRC20) checkout panel. Only rendered when the server's
 * /payments/crypto/config says enabled. The amount, address and expiry all come
 * from the server invoice; the browser decides nothing. No QR library is in
 * package.json, so (per the task) only copy buttons are shown.
 */
interface CryptoInvoice {
  status: "PENDING" | "PAID" | "EXPIRED" | "FAILED";
  track_id: string;
  amount_usdt: string;
  address: string;
  expires_at: string;
  seconds_left: number;
}

const POLL_MS = 15_000;
const BASE = "/api/v1/apps/judge/payments/crypto";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }, []);
  return { copied, copy };
}

function CopyRow({ label, value, id, copied, onCopy }: {
  label: string; value: string; id: string; copied: string | null; onCopy: (k: string, v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3">
      <div className="mb-1 text-[13px] text-slate-400">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <code dir="ltr" className="break-all text-sm font-semibold text-white">{value}</code>
        <button
          type="button"
          onClick={() => onCopy(id, value)}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          {copied === id ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          {copied === id ? "کپی شد" : "کپی"}
        </button>
      </div>
    </div>
  );
}

export function CryptoPayPanel({ planType, accessToken, onClose }: {
  planType: BackendPlanType;
  accessToken: string;
  onClose: () => void;
}) {
  const [invoice, setInvoice] = useState<CryptoInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const { copied, copy } = useCopy();
  const started = useRef(false);
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const res = await fetch(`${BASE}/create-invoice`, {
          method: "POST",
          headers,
          body: JSON.stringify({ plan_type: planType }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.track_id) {
          setInvoice(data as CryptoInvoice);
          setSecondsLeft(Number(data.seconds_left) || 0);
        } else {
          setError(typeof data.message === "string" ? data.message : "صدور فاکتور تتر انجام نشد.");
        }
      } catch {
        setError("خطا در ارتباط با سرور.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Countdown.
  useEffect(() => {
    if (!invoice || invoice.status !== "PENDING") return;
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, [invoice]);

  // Status polling every 15 s; success -> the same result page as Zibal.
  const trackId = invoice?.track_id;
  const pending = invoice?.status === "PENDING";
  useEffect(() => {
    if (!trackId || !pending) return;
    const t = window.setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/status/${trackId}`, { headers });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.status === "PAID") {
          try {
            window.sessionStorage.setItem("roxira_judge_track_id", trackId);
          } catch {
            // the callback page also reads the query string
          }
          window.location.href = `/judge/payment/callback?trackId=${encodeURIComponent(trackId)}&success=1`;
        } else if (res.ok && (data.status === "EXPIRED" || data.status === "FAILED")) {
          setInvoice((inv) => (inv ? { ...inv, status: data.status } : inv));
        }
      } catch {
        // transient: try again on the next tick
      }
    }, POLL_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, pending]);

  const expired = invoice && (invoice.status === "EXPIRED" || (invoice.status === "PENDING" && secondsLeft === 0));
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="dark rounded-2xl border border-white/10 bg-[#0B111F] p-5 text-slate-200" dir="rtl">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-bold text-white">پرداخت با تتر (USDT - TRC20)</h4>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-white">
          بازگشت
        </button>
      </div>

      <div className="mb-4 flex gap-2 rounded-xl border border-amber-400/40 bg-amber-500/[0.08] p-3 text-[13px] leading-relaxed text-amber-200">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          فقط روی شبکهٔ <b>TRC20 (ترون)</b> و دقیقاً با <b>همین مبلغ</b> (با تمام اعشار) واریز کنید. ارسال روی شبکهٔ دیگر
          یا مبلغ متفاوت به‌صورت خودکار فعال نمی‌شود و ممکن است قابل بازگشت نباشد.
        </p>
      </div>

      {!invoice && !error && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> در حال صدور فاکتور...
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-3 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      {invoice && (
        <div className="space-y-3">
          <CopyRow id="amount" label="مبلغ دقیق (USDT)" value={invoice.amount_usdt} copied={copied} onCopy={copy} />
          <CopyRow id="address" label="آدرس کیف پول (شبکه TRC20)" value={invoice.address} copied={copied} onCopy={copy} />
          <div role="status" aria-live="polite" className="text-sm">
            {expired ? (
              <span className="text-rose-300">مهلت پرداخت تمام شد. اگر واریز کرده‌اید با پشتیبانی تماس بگیرید، وگرنه فاکتور جدید بسازید.</span>
            ) : (
              <span className="text-slate-300">
                زمان باقی‌مانده: <b dir="ltr" className="text-white">{mm}:{ss}</b> · هر ۱۵ ثانیه وضعیت بررسی می‌شود.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CryptoPayPanel;
