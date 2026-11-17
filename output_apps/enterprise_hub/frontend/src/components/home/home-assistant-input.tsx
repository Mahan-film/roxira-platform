"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const SUGGESTIONS = [
  "سود و زیان این ماه",
  "چک‌های سررسید ۷ روز آینده",
  "فروش امروز",
  "کالاهای با کسری موجودی",
];

export function HomeAssistantInput() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const handleAsk = (text?: string) => {
    const q = (text ?? query).trim();
    if (!q) return;
    router.push(`/app/assistant?q=${encodeURIComponent(q)}`);
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-transparent shadow-sm">
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Sparkles className="size-4 animate-pulse" aria-hidden="true" />
          <span>پرسش از دستیار هوشمند کسب‌وکار</span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="از دستیار بپرسید... (مثلاً: سود این ماه چقدر بود؟ یا چک‌های سررسید هفته آینده)"
              className="h-11 bg-background/80 pe-3 ps-3 text-sm transition-all focus-visible:ring-primary/40"
              aria-label="پرسش از دستیار هوشمند"
            />
          </div>
          <Button
            type="submit"
            className="h-11 gap-1.5 px-4 font-semibold"
            disabled={!query.trim()}
          >
            <span>بپرسید</span>
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <span className="font-medium">پیشنهادها:</span>
          {SUGGESTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => handleAsk(item)}
              className="rounded-full border border-border/80 bg-background/60 px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              {item}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
