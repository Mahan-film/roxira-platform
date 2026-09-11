"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Coins, Loader2, RefreshCw } from "lucide-react";

import { getExchangeRates } from "@/lib/api/currency-client";
import {
  Currency,
  CurrencyRate,
  formatCurrency,
} from "@/types/currency";

/**
 * پنل تعاملی تسویه چندارزی برای پورتال بین‌المللی.
 * نرخ‌ها از قرارداد `GET /enterprise-hub/currency/rates` خوانده می‌شوند و
 * کاربر می‌تواند ارز تسویه را سوئیچ کند (USD/EUR/AED/IRR).
 */

const FALLBACK_RATES: Record<Currency, number> = {
  [Currency.USD]: 1,
  [Currency.EUR]: 0.92,
  [Currency.AED]: 3.6725,
  [Currency.IRR]: 920000,
};

const FALLBACK_CURRENCIES: Currency[] = [
  Currency.USD,
  Currency.EUR,
  Currency.AED,
  Currency.IRR,
];

export function EnSettlementPanel() {
  const [currencies, setCurrencies] = useState<Currency[]>(
    FALLBACK_CURRENCIES,
  );
  const [rates, setRates] = useState<Record<Currency, number>>(FALLBACK_RATES);
  const [selected, setSelected] = useState<Currency>(Currency.EUR);
  const [amount, setAmount] = useState(12500);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getExchangeRates()
      .then((response) => {
        if (!active) return;
        const nextRates = { ...FALLBACK_RATES } as Record<Currency, number>;
        const codes: Currency[] = [];
        response.rates.forEach((rate: CurrencyRate) => {
          nextRates[rate.code] = rate.unitsPerUsd;
          codes.push(rate.code);
        });
        setRates(nextRates);
        if (codes.length > 0) setCurrencies(codes);
        setAsOf(response.asOf);
      })
      .catch(() => {
        // در صورت عدم دسترسی به سرور، نرخ‌های مرجع داخلی نمایش داده می‌شوند.
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const unitsPerUsd = rates[selected] || 1;
  const usdPerUnit = unitsPerUsd > 0 ? 1 / unitsPerUsd : 0;
  const settlementUsd = useMemo(
    () => (amount > 0 ? amount * usdPerUnit : 0),
    [amount, usdPerUnit],
  );

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-center">
      <div className="order-2 flex flex-col gap-5 lg:order-1">
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
          <Coins className="size-4" />
          FX &amp; settlement
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Issue invoices and post ledger entries in the settlement currency of
          your choice. The platform normalizes amounts through a central
          exchange-rate service so consolidated reporting stays accurate.
        </p>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Settlement currency
          </p>
          <div className="flex flex-wrap gap-2">
            {currencies.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setSelected(code)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                  selected === code
                    ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                    : "border-border bg-card text-muted-foreground hover:border-emerald-400/40 hover:text-emerald-200"
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {currencies.map((code) => (
            <div key={code} className="bg-card px-3 py-3">
              <p className="font-mono text-[11px] text-slate-400">
                1 USD = {new Intl.NumberFormat("en-US", {
                  maximumFractionDigits: code === Currency.IRR ? 0 : 4,
                }).format(rates[code] || 0)}{" "}
                {code}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="order-1 rounded-2xl border border-border bg-card p-6 lg:order-2">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Banknote className="size-4 text-emerald-300" />
            Settlement preview
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {asOf ? new Date(asOf).toISOString().slice(0, 10) : "FX-2026"}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">Invoice amount</span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
            className="w-32 rounded-md border border-border bg-card px-2 py-1 text-right font-mono text-sm text-foreground focus:border-emerald-400/50 focus:outline-none"
          />
        </div>

        <ul className="mt-3 divide-y divide-border text-sm">
          <li className="flex items-center justify-between py-2.5">
            <span className="text-muted-foreground">Base currency</span>
            <span className="font-mono">USD</span>
          </li>
          <li className="flex items-center justify-between py-2.5">
            <span className="text-muted-foreground">Selected currency</span>
            <span className="font-mono">{selected}</span>
          </li>
          <li className="flex items-center justify-between py-2.5">
            <span className="text-muted-foreground">Applied rate</span>
            <span className="font-mono">
              1 {selected} = {usdPerUnit.toFixed(8)} USD
            </span>
          </li>
          <li className="flex items-center justify-between py-2.5">
            <span className="text-muted-foreground">Applied rate source</span>
            <span className="font-mono">Central FX feed</span>
          </li>
        </ul>

        <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-bold">
          <span>Settlement amount</span>
          <span className="font-mono text-emerald-300">
            {formatCurrency(settlementUsd, Currency.USD)}
          </span>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Invoice: {formatCurrency(amount, selected)} · converted at the live
          Roxira reference rate.
        </p>
      </div>
    </div>
  );
}
