"use client";
import { useState } from "react";
import { AiContent } from "@/components/ai-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Streams from /api/ai and renders through <AiContent> so the disclosure is always shown. */
export function AiDemo() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const prompt = String(new FormData(e.currentTarget).get("prompt") ?? "");
    setText("");
    setBusy(true);
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok || !res.body) {
      setText("Request failed.");
      setBusy(false);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      setText((t) => t + dec.decode(value, { stream: true }));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input name="prompt" required maxLength={8000} placeholder="Ask something" />
        <Button type="submit" disabled={busy}>
          Ask
        </Button>
      </form>
      {text && <AiContent>{text}</AiContent>}
    </div>
  );
}
