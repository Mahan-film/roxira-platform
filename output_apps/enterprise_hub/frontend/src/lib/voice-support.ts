/**
 * Feature detection for voice input (Lockdown Mode, hardened Android browsers).
 * Text chat never depends on any of this: when a capability is missing the UI
 * hides the matching button and keeps the text box.
 */
export interface VoiceSupport {
  /** Record a clip and transcribe it (getUserMedia + MediaRecorder). */
  dictation: boolean;
  /** Live call (getUserMedia + WebSocket + AudioContext + AudioWorklet). */
  live: boolean;
}

export const VOICE_UNAVAILABLE_FA =
  "قابلیت صوتی در این مرورگر یا حالت امنیتی (مثل Lockdown Mode) در دسترس نیست. پیام خود را تایپ کنید.";

export function detectVoiceSupport(): VoiceSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { dictation: false, live: false };
  }
  const w = window as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
    AudioWorkletNode?: unknown;
  };
  const media = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  const dictation = media && typeof window.MediaRecorder !== "undefined";
  const live =
    media &&
    typeof window.WebSocket !== "undefined" &&
    !!(w.AudioContext || w.webkitAudioContext) &&
    typeof w.AudioWorkletNode !== "undefined";
  return { dictation, live };
}
