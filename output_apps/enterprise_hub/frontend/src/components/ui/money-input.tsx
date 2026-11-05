"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  appendZeros,
  applyMoneyEdit,
  describeRials,
  formatGroupedRials,
} from "@/lib/money-input";

interface MoneyInputProps {
  /** رشته رقم ریال (ارقام ASCII)، "" وقتی خالی است. */
  value: string;
  onChange: (digits: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  helper?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}

/**
 * ورودی مبلغ ریالی: گروه‌بندی سه‌رقمی با ارقام فارسی، ولی مقداری که به
 * والد می‌رسد همیشه رشته ارقام ASCII است (مثل قبل)، پس منطق ارسال تغییر نمی‌کند.
 */
export function MoneyInput({
  value,
  onChange,
  id,
  disabled,
  placeholder,
  className,
  helper = true,
  ...aria
}: MoneyInputProps) {
  const helperId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const display = formatGroupedRials(value);

  // بازیابی محل کرسر بعد از رندر مجدد (تایپ در وسط عدد جای کرسر را حفظ کند).
  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [display]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const caret = event.target.selectionStart ?? event.target.value.length;
    const { digits, caret: nextCaret } = applyMoneyEdit(event.target.value, caret);
    if (digits !== value) {
      pendingCaret.current = nextCaret;
      onChange(digits);
    }
  }

  function append(count: 3 | 4) {
    const next = appendZeros(value, count);
    if (next !== value) {
      pendingCaret.current = formatGroupedRials(next).length;
      onChange(next);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      append(event.shiftKey ? 4 : 3);
    }
  }

  const described = describeRials(value);

  return (
    <div className="flex flex-col gap-1">
      <Input
        ref={inputRef}
        id={id}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-describedby={helper ? helperId : undefined}
        className={cn("text-start tabular-nums", className)}
        {...(helper === false && described
          ? { title: `${described.toman} — ${described.words}` }
          : {})}
        {...aria}
      />
      {helper && (
        <div
          id={helperId}
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {described && (
            <>
              <div>معادل {described.toman}</div>
              <div>{described.words}</div>
            </>
          )}
        </div>
      )}
      {helper && (
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="افزودن سه صفر"
            onClick={() => append(3)}
          >
            ۰۰۰
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label="افزودن چهار صفر"
            onClick={() => append(4)}
          >
            ۰۰۰۰
          </Button>
        </div>
      )}
    </div>
  );
}
