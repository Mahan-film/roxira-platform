"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateStockItem } from "@/lib/api/inventory-client";
import { loadErrorMessage } from "@/components/app/app-ui";
import { parseMinQuantity } from "@/lib/reorder";

interface MinQuantityEditorProps {
  itemId: number;
  value: number;
  onSaved: () => void;
}

function quantityLabel(value: number): string {
  return value.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
}

/**
 * Shows an item's minimum stock (reorder point) and edits it in place through
 * PATCH /inventory/items/:id. Clicks do not reach the row, which opens the FIFO layers.
 */
export function MinQuantityEditor({ itemId, value, onSaved }: MinQuantityEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(String(value));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const parsed = parseMinQuantity(draft);
    if (parsed === null) {
      setError("عدد صفر یا بیشتر با حداکثر دو رقم اعشار وارد کنید.");
      return;
    }
    setSaving(true);
    try {
      await updateStockItem(itemId, { minQuantity: parsed });
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      setError(loadErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <span className="text-muted-foreground">{quantityLabel(value)}</span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="ویرایش حداقل موجودی"
          title="ویرایش حداقل موجودی (نقطهٔ سفارش)"
          onClick={start}
        >
          <Pencil />
        </Button>
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          inputMode="decimal"
          dir="ltr"
          className="h-7 w-20"
          aria-label="حداقل موجودی"
          aria-invalid={error ? true : undefined}
          autoFocus
        />
        <Button type="button" size="icon-xs" aria-label="ذخیره" disabled={saving} onClick={() => void save()}>
          <Check />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="انصراف"
          disabled={saving}
          onClick={() => setEditing(false)}
        >
          <X />
        </Button>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
