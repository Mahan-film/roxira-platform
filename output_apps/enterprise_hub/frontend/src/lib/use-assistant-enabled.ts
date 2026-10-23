"use client";

import { useEffect, useState } from "react";

import { fetchAssistantEnabled } from "@/lib/api/assistant-client";

/** `null` while loading, then true/false from the API (hidden unless true). */
export function useAssistantEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void fetchAssistantEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
