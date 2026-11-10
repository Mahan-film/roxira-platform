"use client";

import { useEffect, useState } from "react";

import { fetchAssistantEnabled, hasActiveTenant } from "@/lib/api/assistant-client";

/** `null` while loading, then true/false from the API (hidden unless true). */
export function useAssistantEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(() => {
    if (typeof window !== "undefined" && !hasActiveTenant()) {
      return false;
    }
    return null;
  });

  useEffect(() => {
    let active = true;
    const check = () => {
      if (!hasActiveTenant()) {
        if (active) setEnabled(false);
        return;
      }
      void fetchAssistantEnabled().then((value) => {
        if (active) setEnabled(value);
      });
    };

    check();
    window.addEventListener("roxira-auth-changed", check);
    return () => {
      active = false;
      window.removeEventListener("roxira-auth-changed", check);
    };
  }, []);

  return enabled;
}
