"use client";

import { MONEY_UNITS } from "@/lib/fa-format";
import { useMoneyUnit } from "@/lib/money-unit";
import { cn } from "@/lib/utils";

/** Segmented ریال / تومان / میلیون switch; the choice is remembered per organisation. */
export function MoneyUnitSwitch({ className }: { className?: string }) {
  const [unit, setUnit] = useMoneyUnit();
  return (
    <div
      role="radiogroup"
      aria-label="واحد نمایش مبلغ"
      className={cn("inline-flex rounded-md border border-input bg-background p-0.5 text-sm", className)}
    >
      {MONEY_UNITS.map((option) => {
        const selected = option.unit === unit;
        return (
          <button
            key={option.unit}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setUnit(option.unit)}
            className={cn(
              "min-h-11 rounded px-3 sm:min-h-8",
              selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
