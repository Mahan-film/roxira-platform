"use client";

import {
  useEffect,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { isoToJalaliInput } from "@/lib/jalali";
import {
  checkJalaliText,
  jalaliPresets,
  maskJalaliInput,
  stepJalaliText,
  todayJalaliIso,
} from "@/lib/jalali-date-input";

interface JalaliDateInputProps {
  /** Gregorian ISO date (yyyy-mm-dd) or "" when empty. */
  value: string;
  onChange: (isoDate: string) => void;
  id?: string;
  disabled?: boolean;
  /** نمایش ردیف میان‌بر تاریخ (پیش‌فرض خاموش). */
  presets?: boolean;
  /** کدام لبه بازه میان‌بر اعمال شود (پیش‌فرض "from"). */
  presetEdge?: "from" | "to";
}

/**
 * فیلد تاریخ شمسی: متن به‌صورت ۱۴۰۵/۰۸/۱۴ تایپ می‌شود (ارقام فارسی، چیدمان
 * LTR تا ارقام داخل فرم راست‌به‌چپ جابه‌جا نشوند) و والد تاریخ میلادی ISO
 * دریافت می‌کند. تاریخ ناقص/نامعتبر آخرین مقدار معتبر را نگه می‌دارد و
 * نامعتبر بودن علامت‌گذاری می‌شود. با کلیدهای جهت‌دار روز/ماه/سال جابه‌جا می‌شود.
 */
export function JalaliDateInput({
  value,
  onChange,
  id,
  disabled,
  presets = false,
  presetEdge = "from",
}: JalaliDateInputProps) {
  const [text, setText] = useState(() =>
    value ? maskJalaliInput(isoToJalaliInput(value)) : "",
  );
  const [invalid, setInvalid] = useState(false);

  // فقط وقتی مقدار بیرونی با تاریخی که متن فعلی نشان می‌دهد فرق دارد
  // همگام‌سازی شود؛ در حین تایپ (متن ناقص) مقدار والد را بازنویسی نکنیم.
  useEffect(() => {
    const status = checkJalaliText(text);
    const textIso = status.state === "valid" ? status.iso : undefined;
    if ((value || "") !== (textIso || "")) {
      setText(value ? maskJalaliInput(isoToJalaliInput(value)) : "");
      setInvalid(false);
    }
    // وابستگی عمداً فقط value است: تغییر text حین تایپ نباید این افکت را اجرا کند.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: string) {
    setText(next);
    const status = checkJalaliText(next);
    if (status.state === "valid" && status.iso) {
      setInvalid(false);
      onChange(status.iso);
      return;
    }
    if (status.state === "empty") {
      setInvalid(false);
      onChange("");
      return;
    }
    // partial یا invalid: onChange صدا زده نمی‌شود تا آخرین مقدار معتبر بماند.
    setInvalid(status.state === "invalid");
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    commit(maskJalaliInput(event.target.value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const unit = event.shiftKey
      ? "month"
      : event.ctrlKey || event.metaKey
        ? "year"
        : "day";
    const delta = event.key === "ArrowUp" ? 1 : -1;
    const status = checkJalaliText(text);
    const base =
      status.state === "valid"
        ? text
        : maskJalaliInput(isoToJalaliInput(todayJalaliIso()));
    const next = stepJalaliText(base, unit, delta);
    if (next) commit(next);
  }

  function handlePreset(key: string) {
    const preset = jalaliPresets(todayJalaliIso()).find((p) => p.key === key);
    if (!preset) return;
    const iso = presetEdge === "to" ? preset.to : preset.from;
    setText(maskJalaliInput(isoToJalaliInput(iso)));
    setInvalid(false);
    onChange(iso);
  }

  return (
    <div className="grid gap-1">
      <Input
        id={id}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder="۱۴۰۵/۰۸/۱۴"
        disabled={disabled}
        aria-invalid={invalid}
        className="text-start tabular-nums"
      />
      {invalid && (
        <span role="alert" className="text-xs text-destructive">
          تاریخ شمسی معتبر نیست
        </span>
      )}
      {presets && !disabled && (
        <select
          aria-label="میان‌بر تاریخ"
          value=""
          onChange={(event) => handlePreset(event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
        >
          <option value="">میان‌بر…</option>
          {jalaliPresets(todayJalaliIso()).map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
