"use client";

import { useRef, useState, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listStockItems } from "@/lib/api/inventory-client";
import { findExact, normaliseScan, unknownBarcodeMessage } from "@/lib/barcode-scan";
import type { StockItem } from "@/types/inventory";

interface BarcodeScanBoxProps {
  id: string;
  /** Called with the exact item for a scanned or typed code. */
  onItem: (item: StockItem) => void;
}

/**
 * One field for a barcode scanner (or typing a code and pressing Enter). A found item is handed
 * to the form and the field clears, ready for the next scan; an unknown code shows a Persian
 * error and stays in the field so it can be corrected.
 */
export function BarcodeScanBox({ id, onItem }: BarcodeScanBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookUp(raw: string) {
    const term = normaliseScan(raw);
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      // The server lists exact code or barcode matches first.
      const result = await listStockItems({ page: 1, limit: 20, search: term });
      const item = findExact(result.data, term);
      if (item) {
        onItem(item);
        setCode("");
      } else {
        setError(unknownBarcodeMessage(term));
      }
    } catch {
      setError("جستجوی کالا انجام نشد. اتصال را بررسی کنید و دوباره اسکن کنید.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    // Enter from a scanner must not submit the surrounding form.
    event.preventDefault();
    if (!busy) void lookUp(code);
  }

  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>اسکن بارکد</Label>
      <Input
        ref={inputRef}
        id={id}
        dir="ltr"
        autoComplete="off"
        placeholder="بارکد یا کد کالا را اسکن کنید و Enter بزنید"
        value={code}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setCode(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
