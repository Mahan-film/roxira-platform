"use client";

import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { listStockItems } from "@/lib/api/inventory-client";
import type { StockItem } from "@/types/inventory";

interface SkuInputProps {
  value: string;
  onChange: (sku: string) => void;
  /** Called with the full item when the typed text matches an item's code or barcode exactly. */
  onResolved?: (item: StockItem | null) => void;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * Item code / barcode field that searches the item list as the user types (the list can hold
 * thousands of items, so it never loads them all). A scanner that types the code and presses
 * Enter lands the exact item.
 */
export function SkuInput({
  value,
  onChange,
  onResolved,
  placeholder = "کد یا بارکد کالا",
  ariaLabel = "کد یا بارکد کالا",
}: SkuInputProps) {
  const listId = useId();
  const [options, setOptions] = useState<StockItem[]>([]);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 1) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      listStockItems({ page: 1, limit: 15, search: term }, controller.signal)
        .then((result) => {
          setOptions(result.data);
          const exact = result.data.find(
            (item) => item.sku === term || item.barcode === term,
          );
          onResolved?.(exact ?? null);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, onResolved]);

  return (
    <>
      <Input
        value={value}
        list={listId}
        dir="ltr"
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {options.map((item) => (
          <option key={item.id} value={item.sku}>
            {item.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
