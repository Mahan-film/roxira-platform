"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { isoToJalaliInput, jalaliToIso } from "@/lib/jalali";

interface JalaliDateInputProps {
  /** Gregorian ISO date (yyyy-mm-dd) or "" when empty. */
  value: string;
  onChange: (isoDate: string) => void;
  id?: string;
  disabled?: boolean;
}

/**
 * Jalali date field. The text is typed as 1405/08/10 (Persian or Latin digits)
 * and always laid out left-to-right so the digits never reorder inside an RTL form;
 * the parent receives the Gregorian ISO date. An invalid date keeps the last valid
 * value and is flagged, so a half-typed date cannot be submitted by accident.
 */
export function JalaliDateInput({ value, onChange, id, disabled }: JalaliDateInputProps) {
  const [text, setText] = useState(() => (value ? isoToJalaliInput(value) : ""));
  const [invalid, setInvalid] = useState(false);

  function handleChange(next: string) {
    setText(next);
    if (next.trim() === "") {
      setInvalid(false);
      onChange("");
      return;
    }
    const iso = jalaliToIso(next);
    setInvalid(iso === null);
    if (iso) onChange(iso);
  }

  return (
    <div className="grid gap-1">
      <Input
        id={id}
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder="1405/08/10"
        disabled={disabled}
        aria-invalid={invalid}
        className="text-start tabular-nums"
      />
      {invalid && (
        <span role="alert" className="text-xs text-destructive">
          تاریخ شمسی معتبر نیست؛ نمونه: ۱۴۰۵/۰۸/۱۰
        </span>
      )}
    </div>
  );
}
