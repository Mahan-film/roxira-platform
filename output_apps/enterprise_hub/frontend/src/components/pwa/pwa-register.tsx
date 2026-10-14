"use client";

import { useEffect } from "react";

/**
 * ثبت Service Worker فقط روی دامنهٔ «قاضی هوشمند».
 * کامپوننت سبک و بدون UI است؛ در صورت عدم پشتیبانی یا خطا بی‌صدا رد می‌شود.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const host = window.location.hostname.toLowerCase();
    const isGhazi =
      host === "ghazihoushmand.ir" ||
      host === "www.ghazihoushmand.ir" ||
      host.includes("ghazihoushmand") ||
      host.includes("smartjudge") ||
      host.startsWith("ghazi");
    if (!isGhazi) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}

export default PwaRegister;
