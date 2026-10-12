"use client";
import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  FileSignature,
  FileText,
  Gavel,
  Camera,
  Loader2,
  Mic,
  Paperclip,
  Phone,
  Plus,
  RotateCw,
  Send,
  Square,
  X,
} from "lucide-react";
import {
  COMPETENCE_NOTE,
  DISCLAIMER_LINE,
  GUIDED_DRAFT_CHIPS,
  STARTER_GROUPS,
  detectDraftIntent,
  findDraftAction,
  type DraftType,
} from "@/lib/chat-actions";
import { VipGate } from "@/components/draft/vip-gate";
import {
  DraftAssistError,
  draftAssist,
  type DraftAssistRequest,
  type DraftAssistResponse,
  type DraftFields,
  type DraftResult,
} from "@/lib/api/draft-assist-client";
import { DraftInfoCard, DraftResultCard, type DraftSession } from "./draft-cards";
import { MicHint, useMicHint } from "./chat-onboarding";
import { ChatHistory } from "./chat-history";
import type { StoredConversation } from "@/lib/api/conversations-client";
import dynamic from "next/dynamic";

// Loaded only when the user opens a live call (keeps the first load small).
const LiveVoiceModal = dynamic(() => import("./live-voice-modal").then((m) => m.LiveVoiceModal), { ssr: false });
import { ChatHttpError, streamChat } from "@/lib/api/chat-stream";
import {
  CASE_FILE_ACCEPT,
  CASE_FILE_PRIVACY_NOTICE,
  CaseFileError,
  MAX_CASE_FILES_PER_CHAT,
  MAX_CONCURRENT_UPLOADS,
  deleteCaseFile,
  prepareImageForUpload,
  uploadCaseFile,
  validateCaseFile,
  watchCaseFile,
} from "@/lib/api/case-files-client";
import { LegalStreamingText } from "./legal-streaming-text";
import { CaseFileRefChips, parseCaseFileRefs, type CaseFileRef } from "./case-file-refs";
import { useAuth } from "@/components/auth/auth-provider";
import {
  EMPTY_FAILURE,
  JUDGE_TRANSCRIBE_PATH,
  MAX_CHAT_CHARS,
  MAX_RECORDING_MS,
  NETWORK_FAILURE,
  RetryTimeoutError,
  STT_TIMEOUT_MS,
  TIMEOUT_FAILURE,
  audioExtForType,
  authHeaders,
  clearPending,
  failureFromResponse,
  fetchWithRetry,
  loadPending,
  micFailure,
  newRequestId,
  pickRecorderMimeType,
  reportVoiceError,
  savePending,
  withoutAuthHeader,
  type ChatFailure,
} from "@/lib/api/judge-chat-client";

type StatutoryItem =
  | string
  | { title?: string; category?: string; article?: string; law?: string; law_name?: string; article_no?: string | number; number?: string | number };

type Attachment = {
  localId: string;
  name: string;
  /** uploading = bytes on the wire (or queued); processing = server is reading it in the background. */
  status: "uploading" | "processing" | "ready" | "error";
  fileId?: string;
  /** Upload percentage 0-100 while `uploading`; undefined = waiting in the queue / preparing. */
  progress?: number;
  /** Server progress text while `processing` (e.g. "در حال خواندن صفحه ۱۴ از ۴۰"). */
  statusText?: string;
  pages?: number;
  ocrUsed?: boolean;
  warning?: string;
  error?: string;
  /** Kept only until ready so "retry" can resend it. */
  file?: File;
};

const DEFAULT_CASE_PROMPT = "این مدارک را بررسی کن: خلاصه، نکات حقوقی مهم، و اقدام بعدی پیشنهادی";

/** Files already sent in this conversation; the most recent ones are re-sent with every follow-up. */
type ContextFile = { fileId: string; name: string; pages?: number };
const MAX_CONTEXT_FILES = 5;

type ChatMessage = {
  role: string;
  content: string;
  /** Names of the case files sent together with this user message. */
  files?: string[];
  draft?: string;
  probability?: string;
  statutory_basis?: StatutoryItem[];
  /** Page-level sources from uploaded case files. */
  case_file_refs?: CaseFileRef[];
  /** Typewriter animation still running for this (fresh) answer. */
  animating?: boolean;
  /** Error bubble; `retryPrompt` is the user text to resend. */
  isError?: boolean;
  retryPrompt?: string;
  /** Idempotency id of the failed question; a manual retry reuses it. */
  retryRequestId?: string;
  /** Finished draft rendered as a result card under this bubble. */
  draftResult?: DraftResult;
  /** Feature name: render the VIP lock card (real prices + login/upgrade) under this bubble. */
  vipGate?: string;
};

const INITIAL_GREETING = "سلام. شرح پرونده یا پرسش حقوقی خود را بنویسید، یا با میکروفون بگویید.";

const CHIP_ICONS: Record<DraftType, typeof FileText> = {
  ruling: Gavel,
  indictment: FileSignature,
  defense: FileText,
  petition: Gavel,
  complaint: AlertTriangle,
  notice: FileSignature,
};

const LIST_DRAFT_FIELDS = new Set(["evidence", "law_hints"]);
const DRAFT_FILES_PROMPT = "اسناد پرونده را پیوست کردم؛ اطلاعات لازم را از آن‌ها استخراج کن.";

/** Turn a server answer into the session shown by the «اطلاعات پرونده» card. */
type DraftRunOpts = {
  action: DraftAssistRequest["action"];
  type?: DraftType;
  base: ChatMessage[];
  prev: DraftSession | null;
  edits: DraftFields;
  skipped?: string[];
  silent?: boolean;
  intro?: boolean;
  revise?: DraftAssistRequest["revise"];
  fallbackText?: string;
};

function sessionFromResponse(data: DraftAssistResponse, prev: DraftSession | null, edits: DraftFields): DraftSession {
  const type = (data.draft_type ?? prev?.type) as DraftType;
  const missing = data.missing ?? [];
  return {
    type,
    title: data.title ?? prev?.title ?? "",
    meta: data.field_meta ?? prev?.meta ?? [],
    fields: data.fields ?? {},
    edits,
    sources: data.field_sources ?? {},
    missing,
    skipped: data.skipped ?? [],
    choices: data.choices ?? [],
    courtOptions: data.court_options ?? prev?.courtOptions ?? [],
    courtName: data.court_name ?? "",
    courtSuggestion: data.court_suggestion ?? null,
    skipLabel: data.skip_label ?? prev?.skipLabel ?? "نمی‌دانم",
    formUrl: data.form_url ?? prev?.formUrl ?? null,
    status: missing.length ? "collecting" : "ready",
  };
}

function toDraftHistory(msgs: { role: string; content: string; isError?: boolean }[]) {
  return msgs
    .filter((m) => !m.isError && m.content.trim())
    .map((m) => ({ role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant", content: m.content.slice(0, 6000) }))
    .slice(-30);
}

function statutoryLabel(item: StatutoryItem): string {
  if (typeof item === "string") return item;
  if (item.title) return item.title;
  const law = item.law_name || item.law || "";
  const art = item.article_no ?? item.article ?? item.number;
  const lawArt = [art !== undefined && art !== "" ? `ماده ${art}` : "", law].filter(Boolean).join(" ");
  return lawArt || item.category || "";
}

export function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "سلام. شرح پرونده یا پرسش حقوقی خود را بنویسید، یا با میکروفون بگویید."
    }
  ]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>("");
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [isLiveAudioOpen, setIsLiveAudioOpen] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [weakConnection, setWeakConnection] = useState(false);
  const [guestNotice, setGuestNotice] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachNotice, setAttachNotice] = useState("");
  const [contextFiles, setContextFiles] = useState<ContextFile[]>([]);
  const contextRef = useRef<ContextFile[]>([]);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [micFocused, setMicFocused] = useState(false);
  const [draft, setDraft] = useState<DraftSession | null>(null);
  const [reviseIdx, setReviseIdx] = useState<number | null>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const micHint = useMicHint();
  const recoveredRef = useRef(false);
  const { getAccessToken, isAuthenticated, openLogin, logout } = useAuth();
  const recordingTimerRef = useRef<number | null>(null);
  const statusClearRef = useRef<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const draftRef = useRef<DraftSession | null>(null);
  const pendingCheckRef = useRef<DraftRunOpts | null>(null);
  const startDraftRef = useRef<(type: DraftType) => Promise<boolean>>(async () => false);

  messagesRef.current = messages;
  draftRef.current = draft;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // /chat?draft=defense|petition|complaint|notice (links from the header menu)
  // starts the guided drafting conversation.
  const searchParams = useSearchParams();
  const draftParam = searchParams.get("draft");

  const showVoiceError = (message: string) => {
    setRecordingStatus(message);
    if (statusClearRef.current) window.clearTimeout(statusClearRef.current);
    statusClearRef.current = window.setTimeout(() => setRecordingStatus(""), 8000);
  };

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
      if (statusClearRef.current) window.clearTimeout(statusClearRef.current);
    };
  }, []);

  // تبدیل گفتار به متن (STT): ضبط مستقیم صدا و ارسال آن به موتور سرور.
  // هیچ وابستگی‌ای به Web Speech API مرورگر وجود ندارد (سازگار با Safari فارسی).
  const toggleVoiceRecording = async () => {
    micHint.markUsed();
    if (isVoiceRecording) {
      // توقف ضبط صوت و ارسال فایل به سرور
      if (recordingTimerRef.current) {
        window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        setRecordingStatus("در حال پردازش صدا...");
        mediaRecorderRef.current.stop();
      }
      return;
    }

    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
        // بدون alert مسدودکننده: پیام وضعیت درون‌خطی
        reportVoiceError("unsupported", "no mediaDevices/MediaRecorder");
        showVoiceError("مرورگر شما از ضبط صدا پشتیبانی نمی‌کند. لطفاً Safari یا Chrome را به‌روز کنید یا پیام را تایپ کنید.");
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      streamRef.current = stream;

      // Safari/iOS: audio/mp4 (AAC)؛ Chrome/Android: audio/webm (opus)
      const mimeType = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t), navigator.userAgent || "");

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.onerror = () => {
        reportVoiceError("recorder", "MediaRecorder error");
        showVoiceError("ضبط صدا با خطا متوقف شد. دوباره تلاش کنید.");
      };

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setIsVoiceRecording(false);
        if (recordingTimerRef.current) {
          window.clearTimeout(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        // توقف ترک‌های سخت‌افزاری میکروفون
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        // نکتهٔ Safari: آخرین قطعه هنگام stop() در ondataavailable تحویل داده می‌شود
        // (که پیش از onstop اجرا می‌شود)؛ پس تا اینجا همهٔ قطعه‌ها جمع شده‌اند.
        const blobType =
          recorder.mimeType ||
          audioChunksRef.current[0]?.type ||
          "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: blobType });
        audioChunksRef.current = [];

        if (audioBlob.size < 1500) {
          reportVoiceError("empty_audio", `size=${audioBlob.size} type=${blobType}`);
          showVoiceError(
            audioBlob.size === 0
              ? "صدایی ضبط نشد. میکروفون را بررسی کنید و دوباره تلاش کنید."
              : "ضبط خیلی کوتاه بود. دکمه را نگه دارید و کمی بیشتر صحبت کنید.",
          );
          return;
        }

        // صوت ضبط‌شده همیشه مستقیماً به‌صورت multipart/form-data به موتور STT فرستاده می‌شود
        const requestId = newRequestId();
        const startedAt = Date.now();
        try {
          setRecordingStatus("در حال تبدیل گفتار به متن...");
          const formData = new FormData();
          formData.append("file", audioBlob, `speech.${audioExtForType(blobType)}`);

          const send = (headers: Record<string, string>) =>
            fetchWithRetry(
              JUDGE_TRANSCRIBE_PATH,
              { method: "POST", headers, body: formData },
              {
                maxAttempts: 2,
                timeoutMs: STT_TIMEOUT_MS,
                retryOnGatewayStatus: false,
                requestId,
                onRetry: () => setRecordingStatus("اتصال ضعیف است؛ در حال تلاش دوباره…"),
              },
            );

          const headers = authHeaders(getAccessToken());
          let res = await send(headers);
          if (res.status === 401 && Object.keys(headers).length > 0) {
            // Stale token: same silent guest fallback as the text chat (no login modal).
            logout();
            setGuestNotice(true);
            res = await send(withoutAuthHeader(headers));
          }

          if (res.status === 429) {
            showVoiceError("تعداد درخواست‌ها بیش از حد مجاز است. چند دقیقه بعد دوباره تلاش کنید.");
            return;
          }
          if (res.status === 413) {
            reportVoiceError("stt_http", "HTTP 413", requestId, startedAt);
            showVoiceError("فایل صوتی خیلی بزرگ است. پیام کوتاه‌تری ضبط کنید.");
            return;
          }
          const data = res.ok ? await res.json().catch(() => null) : null;
          const transcript = String(data?.text || data?.transcript || "").trim();
          if (transcript) {
            setInputPrompt(transcript.slice(0, MAX_CHAT_CHARS));
            setRecordingStatus("");
          } else if (!res.ok) {
            reportVoiceError("stt_http", `HTTP ${res.status}`, requestId, startedAt);
            showVoiceError("تبدیل گفتار به متن انجام نشد. لطفاً دوباره تلاش کنید یا پیام را تایپ کنید.");
          } else {
            showVoiceError("گفتار شما تشخیص داده نشد. واضح‌تر و نزدیک‌تر به میکروفون صحبت کنید.");
          }
        } catch (err) {
          console.warn("Transcribe-audio request failed:", err);
          // fetchWithRetry already reported each failed attempt (kind network/timeout).
          showVoiceError(
            err instanceof RetryTimeoutError
              ? "پردازش صدا بیش از حد طول کشید. پیام کوتاه‌تری ضبط کنید یا تایپ کنید."
              : "ارتباط با سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.",
          );
        }
      };

      // Safari در برابر timeslice مقاوم نیست؛ در صورت خطا بدون بازهٔ زمانی شروع می‌کنیم
      try {
        recorder.start(250);
      } catch {
        recorder.start();
      }
      setIsVoiceRecording(true);
      setRecordingStatus("در حال ضبط... (حداکثر ۲ دقیقه)");
      // سقف زمان ضبط: پس از ۱۲۰ ثانیه به‌طور خودکار متوقف و ارسال می‌شود
      recordingTimerRef.current = window.setTimeout(() => {
        recordingTimerRef.current = null;
        if (recorder.state !== "inactive") {
          setRecordingStatus("حداکثر زمان ضبط به پایان رسید؛ در حال پردازش صدا...");
          recorder.stop();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.warn("Mic error:", err);
      setIsVoiceRecording(false);
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const failure = micFailure(err);
      reportVoiceError(failure.kind, err instanceof Error ? err.name : "unknown");
      showVoiceError(failure.message);
    }
  };

  // ---- پیوست پرونده (PDF / تصویر / DOCX / TXT) ----
  const patchAttachment = (localId: string, patch: Partial<Attachment>) =>
    setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, ...patch } : a)));

  const askLoginForUpload = () => {
    setAttachNotice("برای بارگذاری پرونده وارد شوید");
    openLogin({
      serviceDomain: "GHAZI",
      title: "ورود به قاضی هوشمند",
      description: "برای بارگذاری پرونده وارد شوید؛ کد تأیید به شمارهٔ همراه شما پیامک می‌شود.",
    });
  };

  const openFilePicker = (camera: boolean) => {
    if (!isAuthenticated) {
      askLoginForUpload();
      return;
    }
    setAttachNotice("");
    (camera ? cameraInputRef : fileInputRef).current?.click();
  };

  // At most MAX_CONCURRENT_UPLOADS transfers at once (phone uplinks); the rest wait in the queue.
  // Server-side reading (polling) does not hold a slot.
  const uploadQueueRef = useRef<Array<() => Promise<void>>>([]);
  const activeUploadsRef = useRef(0);
  const watchersRef = useRef<Map<string, AbortController>>(new Map());
  const removedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const watchers = watchersRef.current;
    return () => watchers.forEach((c) => c.abort());
  }, []);

  const pumpUploads = () => {
    while (activeUploadsRef.current < MAX_CONCURRENT_UPLOADS && uploadQueueRef.current.length) {
      const job = uploadQueueRef.current.shift() as () => Promise<void>;
      activeUploadsRef.current += 1;
      void job().finally(() => {
        activeUploadsRef.current -= 1;
        pumpUploads();
      });
    }
  };

  const failAttachment = (localId: string, err: unknown, file: File | undefined) => {
    const e = err instanceof CaseFileError ? err : null;
    if (e?.code === "ABORTED") return;
    if (e?.status === 401) {
      logout();
      setAttachments((prev) => prev.filter((a) => a.localId !== localId));
      askLoginForUpload();
      return;
    }
    // Validation/limit errors are final; network/timeout/server failures can be retried by hand.
    const retryable = !e || e.status === 0 || e.status === 429 || e.status >= 500 || e.code === "OCR_FAILED";
    patchAttachment(localId, {
      status: "error",
      error: e?.message ?? "بارگذاری فایل انجام نشد؛ لطفاً دوباره تلاش کنید.",
      progress: undefined,
      statusText: undefined,
      file: retryable ? file : undefined,
    });
  };

  const watchProcessing = async (localId: string, fileId: string, file: File) => {
    const ctrl = new AbortController();
    watchersRef.current.set(localId, ctrl);
    try {
      const st = await watchCaseFile(fileId, {
        token: getAccessToken,
        signal: ctrl.signal,
        onUpdate: (u) => {
          if (u.status === "processing") patchAttachment(localId, { statusText: u.message });
        },
      });
      if (st.status === "ready") {
        patchAttachment(localId, {
          status: "ready",
          pages: st.pages || st.pages_total || undefined,
          ocrUsed: st.ocr_used,
          warning: st.warnings?.[0],
          statusText: undefined,
          file: undefined,
        });
      } else {
        patchAttachment(localId, {
          status: "error",
          error: st.message || "پردازش فایل ناموفق بود؛ دوباره تلاش کنید.",
          statusText: undefined,
          fileId: undefined,
          file,
        });
      }
    } catch (err) {
      failAttachment(localId, err, file);
    } finally {
      watchersRef.current.delete(localId);
    }
  };

  const runUpload = async (localId: string, original: File) => {
    if (removedRef.current.has(localId)) return;
    const ctrl = new AbortController();
    watchersRef.current.set(localId, ctrl);
    try {
      patchAttachment(localId, { status: "uploading", progress: 0, error: undefined, file: original });
      const prepared = await prepareImageForUpload(original);
      const invalid = validateCaseFile(prepared);
      if (invalid) throw new CaseFileError(invalid, 400, "CLIENT_INVALID");
      const accepted = await uploadCaseFile(prepared, {
        token: getAccessToken(),
        conversationId: conversationId || undefined,
        signal: ctrl.signal,
        onProgress: (p) => patchAttachment(localId, { progress: p }),
      });
      setAttachNotice("ارسال کامل شد؛ می‌توانید گفتگو را ادامه دهید، پردازش در پس‌زمینه انجام می‌شود.");
      patchAttachment(localId, {
        status: "processing",
        fileId: accepted.id,
        progress: undefined,
        statusText: undefined,
        file: prepared,
      });
      watchersRef.current.delete(localId);
      void watchProcessing(localId, accepted.id, prepared); // does not hold an upload slot
    } catch (err) {
      watchersRef.current.delete(localId);
      failAttachment(localId, err, original);
    }
  };

  const startUpload = (localId: string, file: File) => {
    patchAttachment(localId, { status: "uploading", progress: undefined, error: undefined, file });
    uploadQueueRef.current.push(() => runUpload(localId, file));
    pumpUploads();
  };

  const handleFilesPicked = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (!picked.length) return;
    let room = MAX_CASE_FILES_PER_CHAT - attachments.length;
    for (const file of picked) {
      const invalid = validateCaseFile(file);
      const localId = newRequestId();
      if (invalid) {
        setAttachments((prev) => [...prev, { localId, name: file.name, status: "error", error: invalid }]);
        continue;
      }
      if (room <= 0) {
        setAttachNotice(`حداکثر ${MAX_CASE_FILES_PER_CHAT.toLocaleString("fa-IR")} فایل را می‌توان همزمان پیوست کرد.`);
        break;
      }
      room -= 1;
      setAttachments((prev) => [...prev, { localId, name: file.name, status: "uploading" }]);
      startUpload(localId, file);
    }
  };

  const removeAttachment = (att: Attachment) => {
    watchersRef.current.get(att.localId)?.abort();
    watchersRef.current.delete(att.localId);
    removedRef.current.add(att.localId); // a still-queued upload checks this and never starts
    setAttachments((prev) => prev.filter((a) => a.localId !== att.localId));
    if (att.fileId) {
      contextRef.current = contextRef.current.filter((c) => c.fileId !== att.fileId);
      setContextFiles(contextRef.current);
      void deleteCaseFile(att.fileId, getAccessToken());
    }
  };

  /** Still being read on the server: the composer stays usable, the answer uses the ready pages. */
  const processingFileIds = attachments.filter((a) => a.status === "processing" && a.fileId).map((a) => a.fileId as string);
  const readyFileIds = attachments.filter((a) => a.status === "ready" && a.fileId).map((a) => a.fileId as string);

  const errorBubble = (failure: ChatFailure, prompt: string, requestId: string): ChatMessage => ({
    role: "assistant",
    content: failure.message,
    isError: true,
    retryPrompt: failure.retryable ? prompt : undefined,
    retryRequestId: failure.retryable ? requestId : undefined,
  });

  // پیشرفت: شمارندهٔ ثانیه‌ها تا زمانی که درخواست در جریان است
  useEffect(() => {
    if (!isLoading) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsedSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      window.clearInterval(id);
      setElapsedSec(0);
      setWeakConnection(false);
    };
  }, [isLoading]);

  const sendChat = async (textToSend: string, baseMsgs: ChatMessage[], requestIdIn?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = requestIdIn ?? newRequestId();
    setMessages(baseMsgs);
    setIsLoading(true);
    if (isAuthenticated) setGuestNotice(false);
    savePending(textToSend, requestId);

    const finish = (msg: ChatMessage) => setMessages([...baseMsgs, msg]);

    try {
      // فقط نقش و متن پیام‌های واقعی ارسال می‌شود؛ tier/phone/is_vip را سرور از توکن می‌خواند
      const history = baseMsgs
        .filter((m) => !m.isError)
        .map((m) => ({ role: m.role, content: m.content }));
      let streamed = "";
      const data = await streamChat({
        headers: authHeaders(getAccessToken()),
        payload: {
          messages: history,
          message: textToSend,
          conversation_id: conversationId || undefined,
          request_id: requestId,
          ...(contextRef.current.length ? { case_file_ids: contextRef.current.map((f) => f.fileId) } : {}),
        },
        onDelta: (piece) => {
          streamed += piece;
          setWeakConnection(false);
          setIsLoading(false); // first text arrived: hide the spinner, show live text
          setMessages([...baseMsgs, { role: "assistant", content: streamed }]);
        },
        onReset: () => {
          streamed = "";
          setIsLoading(true);
          setMessages(baseMsgs);
        },
        onRetry: () => setWeakConnection(true),
        // Stale token: drop it silently; streamChat repeats the request once as a guest.
        onAuthExpired: () => {
          logout();
          setGuestNotice(true);
        },
      });
      setWeakConnection(false);

      const reply = typeof (data?.reply ?? data?.response) === "string" ? String(data.reply ?? data.response).trim() : "";
      if (!reply) {
        finish(errorBubble(EMPTY_FAILURE, textToSend, requestId));
        return;
      }
      clearPending();
      if (data.conversation_id && !conversationId) {
        setConversationId(data.conversation_id);
      }
      finish({
        role: "assistant",
        content: reply,
        draft: data.defense_draft,
        probability: data.success_probability,
        statutory_basis: Array.isArray(data.statutory_basis) ? (data.statutory_basis as StatutoryItem[]) : undefined,
        case_file_refs: parseCaseFileRefs(data.case_file_refs),
        // text already streamed live: no typewriter replay
        animating: !streamed,
      });
    } catch (err) {
      setWeakConnection(false);
      if (err instanceof ChatHttpError) {
        const failure = failureFromResponse(err.status, err.body);
        if (failure.kind === "auth") logout(); // never open the login modal automatically
        if (!failure.retryable) clearPending();
        finish(errorBubble(failure, textToSend, requestId));
      } else {
        finish(errorBubble(err instanceof RetryTimeoutError ? TIMEOUT_FAILURE : NETWORK_FAILURE, textToSend, requestId));
      }
    } finally {
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  // ---- تنظیم پیش‌نویس در گفتگو (draft-assist) ----
  const caseIds = (): string[] =>
    Array.from(new Set([...contextRef.current.map((f) => f.fileId), ...readyFileIds, ...processingFileIds])).slice(-MAX_CASE_FILES_PER_CHAT);

  /**
   * One request to /draft-assist and the matching UI update. `silent` = card refresh only (no spinner,
   * no new bubble). Returns false when the server says the text is not a draft request.
   */
  const runDraft = async (opts: DraftRunOpts): Promise<boolean> => {
    if (busyRef.current) {
      // A card refresh must not be lost: remember the latest one and run it when the current call ends.
      if (opts.silent && opts.action === "check") pendingCheckRef.current = opts;
      return false;
    }
    busyRef.current = true;
    if (!opts.silent) setIsLoading(true);
    if (!opts.silent) setMessages(opts.base);
    let notDraft = false;
    try {
     run: {
      const known = opts.action === "assist" ? opts.edits : { ...(opts.prev?.fields ?? {}), ...opts.edits };
      const data = await draftAssist(
        {
          action: opts.action,
          draft_type: opts.type ?? opts.prev?.type,
          messages: toDraftHistory(opts.base),
          case_file_ids: caseIds(),
          known_fields: known,
          skip_fields: opts.skipped ?? opts.prev?.skipped ?? [],
          ...(opts.revise ? { revise: opts.revise } : {}),
        },
        {
          token: getAccessToken(),
          onAuthExpired: () => {
            logout();
            setGuestNotice(true);
          },
        },
      );
      if (data.status === "not_draft") {
        notDraft = true;
        break run; // leave the try so `finally` runs, then fall back to the normal chat below
      }
      if (data.status === "vip_required") {
        const label = GUIDED_DRAFT_CHIPS.find((c) => c.key === data.draft_type)?.label ?? "این پیش‌نویس";
        setDraft(null);
        setMessages([...opts.base, { role: "assistant", content: data.message ?? "", vipGate: label }]);
        return true;
      }
      if (data.status === "draft") {
        const title = data.title ?? opts.prev?.title ?? "";
        setDraft((d) => (d ? { ...d, status: "done" } : d));
        setMessages([
          ...opts.base,
          {
            role: "assistant",
            content: `پیش‌نویس «${title}» تنظیم شد. می‌توانید آن را کپی، دانلود یا با «اصلاح کن» ویرایش کنید.`,
            draftResult: {
              draft_type: (data.draft_type ?? opts.prev?.type) as DraftType,
              title,
              draft_markdown: data.draft_markdown ?? "",
              citations: data.citations ?? [],
              warnings: data.warnings ?? [],
              disclaimer: data.disclaimer,
            },
          },
        ]);
        return true;
      }
      if (data.status === "insufficient") {
        setDraft((d) => (d ? { ...d, status: d.missing.length ? "collecting" : "ready" } : d));
        setMessages([...opts.base, { role: "assistant", content: data.message ?? "اطلاعات برای تنظیم پیش‌نویس کافی نیست." }]);
        return true;
      }
      const next = sessionFromResponse(data, opts.prev, opts.edits);
      setDraft(next);
      if (opts.silent) return true;
      const text =
        data.status === "need_info"
          ? [opts.intro ? data.intro : "", data.question].filter(Boolean).join("\n\n")
          : [opts.intro ? data.intro : "", data.message].filter(Boolean).join("\n\n");
      setMessages([...opts.base, { role: "assistant", content: text }]);
      if (opts.action === "generate" && opts.revise) {
        // need_info while revising: the previous draft stays in the conversation; keep it revisable.
        const idx = opts.base.map((m) => !!m.draftResult).lastIndexOf(true);
        if (idx >= 0) setReviseIdx(idx);
      }
     }
    } catch (err) {
      const failure = err instanceof DraftAssistError ? err.failure : null;
      if (failure?.kind === "auth") logout();
      setDraft((d) => (d && d.status === "generating" ? { ...d, status: d.missing.length ? "collecting" : "ready" } : d));
      // A failed card refresh stays quiet: its `base` may be older than the visible conversation.
      if (!opts.silent) {
        setMessages([
          ...opts.base,
          { role: "assistant", content: failure?.message ?? "تنظیم پیش‌نویس انجام نشد؛ دوباره تلاش کنید.", isError: true },
        ]);
      }
    } finally {
      busyRef.current = false;
      setIsLoading(false);
      const pending = pendingCheckRef.current;
      if (pending && !notDraft) {
        pendingCheckRef.current = null;
        // latest pending check, built from the newest draft state
        const latest = draftRef.current;
        window.setTimeout(() => void runDraft(latest ? { ...pending, base: messagesRef.current, prev: latest, edits: latest.edits, skipped: latest.skipped } : { ...pending, base: messagesRef.current }), 0);
      }
    }
    if (notDraft && opts.fallbackText) await sendChat(opts.fallbackText, opts.base);
    return true;
  };

  const startDraft = async (type: DraftType): Promise<boolean> => {
    if (busyRef.current) return false;
    setReviseIdx(null);
    // Always the newest history (this also runs from a timer after the first render).
    const base = messagesRef.current;
    const hasContext = base.some((m) => m.role === "user") || caseIds().length > 0;
    // Without context a cheap "check" call is enough (it still enforces the VIP rule before any typing).
    return runDraft({ action: hasContext ? "assist" : "check", type, base, prev: null, edits: {}, intro: true });
  };
  startDraftRef.current = startDraft;

  const sendDraftTurn = async (userMsg: ChatMessage): Promise<boolean> => {
    if (!draft) return true;
    return runDraft({ action: "assist", base: [...messages, userMsg], prev: draft, edits: draft.edits });
  };

  const editDraftField = (key: string, raw: string) => {
    const draft = draftRef.current;
    if (!draft) return;
    const value = raw.trim();
    const edits = { ...draft.edits };
    const fields = { ...draft.fields };
    if (!value) {
      delete edits[key];
      delete fields[key];
    } else {
      const v = LIST_DRAFT_FIELDS.has(key) ? value.split("\n").map((x) => x.trim()).filter(Boolean) : value;
      edits[key] = v;
      fields[key] = v;
    }
    const prev = { ...draft, edits, fields, skipped: draft.skipped.filter((k) => k !== key) };
    draftRef.current = prev;
    setDraft(prev);
    void runDraft({ action: "check", base: messagesRef.current, prev, edits, skipped: prev.skipped, silent: true });
  };

  const chooseCourt = (value: string, label: string) => {
    if (!draft) return;
    const edits = { ...draft.edits, court_type: value };
    const prev = { ...draft, edits, fields: { ...draft.fields, court_type: value } };
    void runDraft({ action: "check", base: [...messages, { role: "user", content: label }], prev, edits });
  };

  const skipDraftField = (key: string, label: string) => {
    if (!draft) return;
    const skipped = [...draft.skipped, key];
    void runDraft({
      action: "check",
      base: [...messages, { role: "user", content: `${label}: نمی‌دانم` }],
      prev: draft,
      edits: draft.edits,
      skipped,
    });
  };

  const generateDraft = async (revise?: DraftAssistRequest["revise"], base?: ChatMessage[]): Promise<boolean> => {
    if (!draft) return true;
    if (busyRef.current) return false;
    setDraft({ ...draft, status: "generating" });
    const ok = await runDraft({ action: "generate", base: base ?? messages, prev: draft, edits: draft.edits, revise });
    if (!ok) setDraft((d) => (d && d.status === "generating" ? { ...d, status: d.missing.length ? "collecting" : "ready" } : d));
    return ok;
  };

  const exitDraft = () => {
    setDraft(null);
    setReviseIdx(null);
  };

  // History drawer: swap in a saved conversation (messages + up to 5 case files) or a blank one.
  const resetForConversation = (id: string, msgs: ChatMessage[], files: ContextFile[]) => {
    setDraft(null);
    setReviseIdx(null);
    setAttachments([]);
    setInputPrompt("");
    setGuestNotice(false);
    setCtxOpen(false);
    contextRef.current = files.slice(-MAX_CONTEXT_FILES);
    setContextFiles(contextRef.current);
    setConversationId(id);
    setMessages(msgs);
  };
  const restoreConversation = (id: string, conv: StoredConversation) =>
    resetForConversation(
      id,
      conv.messages.length
        ? conv.messages.map((m) => ({
            role: m.role,
            content: m.text,
            ...(m.draft ? { draft: m.draft } : {}),
            ...(m.probability ? { probability: m.probability } : {}),
          }))
        : [{ role: "assistant", content: INITIAL_GREETING }],
      conv.caseFiles.map((f) => ({ fileId: f.id, name: f.name, pages: f.pages || undefined })),
    );
  const startNewConversation = () =>
    resetForConversation("", [{ role: "assistant", content: INITIAL_GREETING }], []);

  useEffect(() => {
    const action = findDraftAction(draftParam);
    if (!action) return;
    const t = window.setTimeout(() => void startDraftRef.current(action.key), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam]);

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend =
      customPrompt || inputPrompt || (readyFileIds.length ? (draft ? DRAFT_FILES_PROMPT : DEFAULT_CASE_PROMPT) : "");
    if (!textToSend || !textToSend.trim() || isLoading) return;
    if (textToSend.length > MAX_CHAT_CHARS) return;
    if (busyRef.current) {
      // Only a silent card refresh can be running here (isLoading is false): wait for it instead of dropping the text.
      for (let i = 0; i < 40 && busyRef.current; i++) await new Promise((r) => setTimeout(r, 200));
      if (busyRef.current) {
        showVoiceError("در حال به‌روزرسانی اطلاعات هستیم؛ چند لحظه بعد دوباره ارسال کنید.");
        return; // the text stays in the composer
      }
    }
    const restoreText = () => {
      if (!customPrompt) setInputPrompt(textToSend);
      showVoiceError("پیام ارسال نشد چون درخواست قبلی هنوز در حال انجام است؛ دوباره ارسال کنید.");
    };

    // Ready attachments move into this message and into the conversation context
    // (max 5, most recent); failed chips stay in the composer for retry.
    const sent = attachments.filter((a) => a.status === "ready" && a.fileId);
    // Files still being read join the context too (the server answers from the ready pages and says
    // which file is pending) but their chips stay so the progress remains visible.
    const pending = attachments.filter((a) => a.status === "processing" && a.fileId);
    if (sent.length || pending.length) {
      const added: ContextFile[] = [...sent, ...pending].map((a) => ({ fileId: a.fileId as string, name: a.name, pages: a.pages }));
      const merged = [...contextRef.current.filter((c) => !added.some((n) => n.fileId === c.fileId)), ...added].slice(-MAX_CONTEXT_FILES);
      contextRef.current = merged;
      setContextFiles(merged);
      if (sent.length) setAttachments((prev) => prev.filter((a) => !sent.includes(a)));
    }
    setInputPrompt("");
    const userMsg: ChatMessage = {
      role: "user",
      content: textToSend,
      ...(sent.length ? { files: sent.map((a) => a.name) } : {}),
    };
    const previous = reviseIdx !== null ? messages[reviseIdx]?.draftResult : undefined;
    if (previous && draft) {
      // «اصلاح کن»: the typed text is an edit instruction for the finished draft.
      setReviseIdx(null);
      const ok = await generateDraft(
        { instruction: textToSend.slice(0, 1500), previous_draft: previous.draft_markdown.slice(0, 30000) },
        [...messages, userMsg],
      );
      if (!ok) {
        setReviseIdx(reviseIdx);
        restoreText();
      }
      return;
    }
    if (draft) {
      if (!(await sendDraftTurn(userMsg))) restoreText();
      return;
    }
    if (!customPrompt && detectDraftIntent(textToSend)) {
      // The server re-checks the intent; `not_draft` falls back to the normal chat answer.
      const ok = await runDraft({
        action: "assist",
        base: [...messages, userMsg],
        prev: null,
        edits: {},
        intro: true,
        fallbackText: textToSend,
      });
      if (!ok) restoreText();
      return;
    }
    await sendChat(textToSend, [...messages, userMsg]);
  };

  const removeContextFile = (f: ContextFile) => {
    contextRef.current = contextRef.current.filter((c) => c.fileId !== f.fileId);
    setContextFiles(contextRef.current);
    if (contextRef.current.length === 0) setCtxOpen(false);
    void deleteCaseFile(f.fileId, getAccessToken());
  };

  // تلاش مجدد: حباب خطا حذف و همان پرسش بدون تکرار پیام کاربر دوباره ارسال می‌شود
  const handleRetry = async (idx: number) => {
    if (isLoading) return;
    const msg = messages[idx];
    if (!msg?.retryPrompt) return;
    await sendChat(msg.retryPrompt, messages.slice(0, idx), msg.retryRequestId);
  };

  // بازیابی پاسخ پس از بارگذاری مجدد صفحه: همان request_id دوباره ارسال می‌شود
  useEffect(() => {
    if (recoveredRef.current || !isAuthenticated) return;
    recoveredRef.current = true;
    const pending = loadPending();
    if (!pending) return;
    window.setTimeout(() => {
      void sendChat(pending.text, [...messages, { role: "user", content: pending.text }], pending.request_id);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const overLimit = inputPrompt.length > MAX_CHAT_CHARS;
  // Guests see the login nudge only after the first real answer.
  const hasAnswer = messages.some((m, i) => i > 0 && m.role === "assistant" && !m.isError);

  // Auto-grow the composer between 1 and 5 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 5 * 26 + 16)}px`;
  }, [inputPrompt]);

  // Close the "+" menu on outside press / Escape.
  useEffect(() => {
    if (!plusOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlusOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [plusOpen]);

  const showExamples = !isLoading && !messages.some((msg) => msg.role === "user");

  return (
    <div className="flex flex-col h-full w-full max-w-[var(--ap-content-max)] mx-auto overflow-hidden">
      <ChatHistory
        activeId={conversationId}
        busy={isLoading || draft?.status === "generating" || attachments.some((a) => a.status === "uploading" || a.status === "processing")}
        hasUnsaved={Boolean(inputPrompt.trim()) || draft !== null || attachments.length > 0}
        onRestore={restoreConversation}
        onNew={startNewConversation}
      />
      {/* ناحیه اسکرول پیام‌ها */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 space-y-4" role="log" aria-live="polite" aria-label="گفتگو">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`ap-bubble ${msg.role === "user" ? "ap-bubble-user" : "ap-bubble-ai"}`}>
              {msg.role === "assistant" && (
                <div className="flex items-center gap-2 mb-2 ap-notice">
                  <span>دستیار</span>
                  {msg.probability && (
                    <span className="ms-auto rounded-full px-2 py-0.5" style={{ background: "var(--ap-surface-2)" }}>
                      احتمال موفقیت: {msg.probability}
                    </span>
                  )}
                </div>
              )}

              {msg.role === "assistant" && !msg.isError ? (
                <LegalStreamingText
                  variant="plain"
                  content={msg.content}
                  isStreaming={Boolean(msg.animating)}
                  onComplete={() =>
                    setMessages((prev) =>
                      prev.map((m, i) => (i === idx && m.animating ? { ...m, animating: false } : m)),
                    )
                  }
                />
              ) : (
                <div
                  className="whitespace-pre-line"
                  role={msg.isError ? "alert" : undefined}
                  style={msg.isError ? { color: "var(--ap-danger)" } : undefined}
                >
                  {msg.content}
                </div>
              )}

              {msg.files && msg.files.length > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] opacity-90" dir="auto">
                  <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {msg.files.length.toLocaleString("fa-IR")} فایل: {msg.files.join("، ")}
                  </span>
                </p>
              )}

              {msg.isError && msg.retryPrompt && (
                <button type="button" onClick={() => void handleRetry(idx)} disabled={isLoading} className="ap-chip mt-2">
                  <RotateCw className="size-4" aria-hidden="true" />
                  <span>تلاش مجدد</span>
                </button>
              )}

              {msg.draft && (
                <div className="mt-3 p-3 rounded-[14px]" style={{ background: "var(--ap-surface-2)" }}>
                  <div className="flex items-center justify-between gap-2 mb-2 text-sm font-semibold" style={{ color: "var(--ap-warn)" }}>
                    <span>پیش‌نویس لایحه قانونی:</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(msg.draft || "")}
                      className="ap-chip"
                    >
                      کپی لایحه
                    </button>
                  </div>
                  <pre className="ap-muted text-xs font-mono whitespace-pre-wrap leading-relaxed">{msg.draft}</pre>
                </div>
              )}

              {msg.vipGate && (
                <div className="mt-3">
                  <VipGate feature={msg.vipGate}>
                    <p className="ap-notice">اشتراک شما فعال است؛ دوباره روی همان پیش‌نویس بزنید.</p>
                  </VipGate>
                </div>
              )}

              {msg.draftResult && (
                <DraftResultCard
                  result={msg.draftResult}
                  busy={isLoading || !draft}
                  onRevise={() => {
                    setReviseIdx(idx);
                    textareaRef.current?.focus();
                  }}
                />
              )}

              {msg.role === "assistant" && msg.case_file_refs && <CaseFileRefChips refs={msg.case_file_refs} />}

              {msg.role === "assistant" && msg.statutory_basis && msg.statutory_basis.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--ap-line)" }}>
                  <div className="mb-1.5 text-sm font-semibold ap-link">مستندات</div>
                  <ul className="list-disc ps-4 space-y-1 ap-notice">
                    {msg.statutory_basis.map((item, itemIdx) => (
                      <li key={itemIdx}>{statutoryLabel(item)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start" role="status">
            <div className="ap-bubble ap-bubble-ai flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full animate-ping" style={{ background: "var(--ap-accent)" }} aria-hidden="true" />
              <span>
                {weakConnection
                  ? "اتصال ضعیف است؛ در حال تلاش دوباره…"
                  : elapsedSec >= 8
                  ? `در حال بررسی قوانین و آرا… ${elapsedSec.toLocaleString("fa-IR")} ثانیه`
                  : "در حال تحلیل پرونده..."}
              </span>
            </div>
          </div>
        )}

        {draft && (
          <>
            <DraftInfoCard
              session={draft}
              busy={isLoading}
              onEdit={editDraftField}
              onConfirmCourt={(key) => editDraftField("court_type", key)}
              onGenerate={() => void generateDraft()}
              onExit={exitDraft}
            />
            {draft.status === "collecting" && !isLoading && draft.missing.length > 0 && (
              <div className="ap-chip-row" role="group" aria-label="پاسخ سریع">
                {draft.missing.slice(0, 2).some((m) => m.key === "court_type") &&
                  draft.choices.map((c) => (
                    <button key={c.value} type="button" className="ap-chip ap-chip-link" onClick={() => chooseCourt(c.value, c.label)}>
                      {c.label}
                    </button>
                  ))}
                {draft.missing
                  .slice(0, 2)
                  .filter((m) => m.skippable)
                  .map((m) => (
                    <button key={m.key} type="button" className="ap-chip" onClick={() => skipDraftField(m.key, m.label)}>
                      {m.label}: {draft.skipLabel}
                    </button>
                  ))}
              </div>
            )}
          </>
        )}

        {/* پرسش‌های نمونه، گروه‌بندی‌شده، در ناحیه خالی پیام‌ها */}
        {showExamples && (
          <section className="space-y-5 pt-2" aria-label="پرسش‌های نمونه">
            <p className="ap-notice">{COMPETENCE_NOTE}</p>
            <p className="ap-notice">
              پرسش خوب شامل واقعیت‌ها، تاریخ، شهر، نوع مرجع و خواسته شماست —{" "}
              <Link href="/guide#good-question" className="ap-link underline">
                نمونه‌ها در راهنما
              </Link>
            </p>
            {STARTER_GROUPS.map((group) => (
              <div key={group.title}>
                <h2 className="ap-group-title">{group.title}</h2>
                <div className="ap-starter-grid">
                  {group.items.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => handleSendMessage(item.prompt)}
                      className="ap-starter"
                    >
                      <span className="font-semibold">{item.title}</span>
                      <span className="mt-1 block ap-muted text-xs leading-relaxed line-clamp-2">{item.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ناحیه ورودی داک‌شده در پایین */}
      <div className="shrink-0 space-y-1.5 px-3 pb-2 pt-2 sm:space-y-3 sm:px-6 sm:pb-3 sm:pt-3" style={{ borderTop: "1px solid var(--ap-line)" }}>
        {/* اقدامات حقوقی: چت‌محور + پیوند به صفحه‌های اختصاصی */}
        <div className="ap-chip-row scroll-fade-x max-w-full min-w-0 touch-pan-x" role="group" aria-label="اقدامات حقوقی">
          <span className="ap-notice whitespace-nowrap font-semibold">اقدامات حقوقی</span>
          {GUIDED_DRAFT_CHIPS.map((chip) => {
            const Icon = CHIP_ICONS[chip.key];
            return (
              <button key={chip.key} type="button" onClick={() => void startDraft(chip.key)} disabled={isLoading} className="ap-chip">
                <Icon className="size-4 ap-chip-icon" aria-hidden="true" />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>

        {guestNotice && !isAuthenticated && (
          <p className="ap-notice text-center" role="status">
            نشست شما منقضی شده؛ پاسخ با حساب مهمان داده شد —{" "}
            <button
              type="button"
              className="ap-link underline"
              onClick={() =>
                openLogin({
                  serviceDomain: "GHAZI",
                  title: "ورود به قاضی هوشمند",
                  description: "کد تأیید به شمارهٔ همراه شما پیامک می‌شود.",
                })
              }
            >
              برای ادامه با حساب خود وارد شوید
            </button>
          </p>
        )}

        {/* وضعیت زنده ضبط صدا */}
        {recordingStatus && (
          <div className="ap-notice flex items-center gap-2" role="status" aria-live="polite">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--ap-danger)" }} aria-hidden="true" />
            <span style={{ color: "var(--ap-text)" }}>{recordingStatus}</span>
          </div>
        )}

        {/* فایل‌ها: یک ردیف فشرده و اسکرول‌پذیر افقی (حداکثر ~۵۶ پیکسل) */}
        {(attachments.length > 0 || contextFiles.length > 0) && (
          <div className="relative">
            <ul className="ap-chip-row ap-attach-row" aria-label="فایل‌های پیوست‌شده">
              {contextFiles.length > 0 && (
                <li className="shrink-0">
                  <button
                    type="button"
                    className="ap-chip ap-chip-sm ap-chip-link"
                    aria-expanded={ctxOpen}
                    onClick={() => setCtxOpen((v) => !v)}
                  >
                    <Paperclip className="size-3.5" aria-hidden="true" />
                    <span>پرونده‌های این گفتگو ({contextFiles.length.toLocaleString("fa-IR")})</span>
                  </button>
                </li>
              )}
              {attachments.map((att) => (
                <li
                  key={att.localId}
                  className="ap-chip ap-chip-sm"
                  style={att.status === "error" ? { color: "var(--ap-danger)" } : undefined}
                  title={att.warning ?? att.name}
                >
                  {att.status === "uploading" || att.status === "processing" ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : att.status === "error" ? (
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                  ) : (
                    <FileText className="size-3.5" aria-hidden="true" />
                  )}
                  <span className="truncate max-w-[7.5rem]" dir="auto">{att.name}</span>
                  <span className="ap-muted whitespace-nowrap" role={att.status === "error" ? "alert" : "status"}>
                    {att.status === "uploading"
                      ? att.progress === undefined
                        ? "در صف ارسال…"
                        : `در حال ارسال ${att.progress.toLocaleString("fa-IR")}٪`
                      : att.status === "processing"
                      ? att.statusText ?? "در حال خواندن فایل…"
                      : att.status === "error"
                      ? att.error
                      : `${(att.pages ?? 1).toLocaleString("fa-IR")} صفحه${att.ocrUsed ? " · OCR" : ""}`}
                  </span>
                  {att.status === "error" && att.file && (
                    <button
                      type="button"
                      onClick={() => void startUpload(att.localId, att.file as File)}
                      aria-label={`تلاش مجدد برای ${att.name}`}
                      className="ap-link underline"
                    >
                      تلاش مجدد
                    </button>
                  )}
                  <button type="button" onClick={() => removeAttachment(att)} aria-label={`حذف ${att.name}`}>
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            {ctxOpen && contextFiles.length > 0 && (
              <div className="ap-menu" style={{ top: "auto", bottom: "calc(100% + 6px)", maxHeight: "40vh", overflowY: "auto" }} role="group" aria-label="پرونده‌های این گفتگو">
                <div className="ap-menu-label">این فایل‌ها در پرسش‌های بعدی هم استفاده می‌شوند</div>
                {contextFiles.map((f) => (
                  <div key={f.fileId} className="ap-menuitem" style={{ cursor: "default" }}>
                    <span className="min-w-0 flex-1 truncate" dir="auto">{f.name}</span>
                    <button type="button" className="ap-link underline" onClick={() => removeContextFile(f)} aria-label={`حذف ${f.name} از پرونده‌های گفتگو`}>
                      حذف
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {reviseIdx !== null && (
          <p className="ap-notice flex items-center gap-2" role="status">
            <span>دستور اصلاح را بنویسید (مثلاً: «کوتاه‌تر کن» یا «لحن رسمی‌تر»).</span>
            <button type="button" className="ap-link underline" onClick={() => setReviseIdx(null)}>
              انصراف
            </button>
          </p>
        )}
        {micHint.show && micFocused && !isVoiceRecording && <MicHint onDismiss={micHint.markUsed} />}

        {/* جعبه ارسال پیام و دکمه‌های صوتی */}
        <div className="ap-composer">
          <input
            ref={fileInputRef}
            type="file"
            accept={CASE_FILE_ACCEPT}
            multiple
            hidden
            data-testid="case-file-input"
            onChange={(e) => handleFilesPicked(e.target.files)}
          />
          {/* موبایل: مستقیماً دوربین را باز می‌کند (در دسکتاپ مانند انتخاب فایل است) */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            data-testid="case-camera-input"
            onChange={(e) => handleFilesPicked(e.target.files)}
          />
          <div className="ap-dropdown" ref={plusRef}>
            <button
              type="button"
              className="ap-iconbtn"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              aria-label="پیوست و ابزارها"
              title="پیوست پرونده، عکس سند"
              onClick={() => setPlusOpen((v) => !v)}
            >
              <Plus className="size-5" aria-hidden="true" />
            </button>
            {plusOpen && (
              <div className="ap-menu" role="menu" style={{ top: "auto", bottom: "calc(100% + 8px)" }}>
                <button
                  type="button"
                  role="menuitem"
                  className="ap-menuitem"
                  onClick={() => {
                    setPlusOpen(false);
                    openFilePicker(false);
                  }}
                >
                  <Paperclip className="size-4" aria-hidden="true" />
                  <span>پیوست پرونده (PDF، تصویر، DOCX، TXT)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ap-menuitem"
                  onClick={() => {
                    setPlusOpen(false);
                    openFilePicker(true);
                  }}
                >
                  <Camera className="size-4" aria-hidden="true" />
                  <span>عکس گرفتن از سند</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ap-menuitem ap-only-narrow"
                  onClick={() => {
                    setPlusOpen(false);
                    setIsLiveAudioOpen(true);
                  }}
                >
                  <Phone className="size-4" aria-hidden="true" />
                  <span>مکالمه صوتی زنده</span>
                </button>
              </div>
            )}
          </div>
          <textarea
            ref={textareaRef}
            rows={1}
            aria-label="پیام شما"
            placeholder="پیام خود را بنویسید..."
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            aria-invalid={overLimit}
            enterKeyHint="enter"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              // IME composition (Persian/CJK keyboards): Enter confirms the candidate, never sends.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              // Touch devices: Enter is a newline, the send button sends.
              if (window.matchMedia("(pointer: coarse)").matches) return;
              e.preventDefault();
              void handleSendMessage();
            }}
          />

          {/* دکمه تبدیل گفتار به متن (Voice STT) */}
          <button
            type="button"
            onClick={toggleVoiceRecording}
            onFocus={() => setMicFocused(true)}
            className={`ap-iconbtn ${isVoiceRecording ? "animate-pulse" : ""}`}
            data-active={isVoiceRecording}
            aria-label={isVoiceRecording ? "اتمام ضبط" : "تبدیل گفتار به متن"}
            aria-pressed={isVoiceRecording}
            title={isVoiceRecording ? "اتمام ضبط" : "تبدیل گفتار به متن"}
          >
            {isVoiceRecording ? <Square className="size-4" aria-hidden="true" /> : <Mic className="size-5" aria-hidden="true" />}
          </button>

          {/* دکمه تماس صوتی زنده (روی صفحه‌های باریک داخل منوی +) */}
          <button
            type="button"
            onClick={() => {
              setIsLiveAudioOpen(true);
            }}
            className="ap-iconbtn ap-hide-narrow"
            aria-label="مکالمه صوتی زنده"
            title="مکالمه صوتی زنده"
          >
            <Phone className="size-5" aria-hidden="true" />
          </button>

          {/* دکمه ارسال پیام */}
          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={isLoading || overLimit}
            className="ap-btn ap-send"
            aria-label="ارسال"
            title="ارسال"
          >
            <span className="ap-send-label">ارسال</span>
            <Send className="size-4 -scale-x-100" aria-hidden="true" />
          </button>
        </div>

        {attachNotice && (
          <p className="ap-notice text-center" role="status">{attachNotice}</p>
        )}
        {attachments.length > 0 && <p className="ap-notice text-center">{CASE_FILE_PRIVACY_NOTICE}</p>}

        {(inputPrompt.length > MAX_CHAT_CHARS * 0.8 || overLimit) && (
          <div
            className="ap-notice text-end"
            style={overLimit ? { color: "var(--ap-danger)" } : undefined}
            role={overLimit ? "alert" : undefined}
          >
            {inputPrompt.length.toLocaleString("fa-IR")} / {MAX_CHAT_CHARS.toLocaleString("fa-IR")}
            {overLimit ? " — پیام طولانی‌تر از حد مجاز است؛ لطفاً کوتاه‌تر کنید." : ""}
          </div>
        )}

        {/* ورود: فقط پس از اولین پاسخ برای مهمان */}
        {!isAuthenticated && hasAnswer && (
          <p className="ap-notice text-center">
            <button
              type="button"
              className="ap-link underline"
              onClick={() =>
                openLogin({
                  serviceDomain: "GHAZI",
                  title: "ورود به قاضی هوشمند",
                  description: "برای پاسخ‌های کامل‌تر وارد شوید؛ کد تأیید به شمارهٔ همراه شما پیامک می‌شود.",
                })
              }
            >
              برای پاسخ‌های کامل‌تر وارد شوید
            </button>
          </p>
        )}

        {/* یک خط: سلب مسئولیت (فقط یک بار) + پیوند راهنما */}
        <p className="ap-notice text-center" role="note">
          {DISCLAIMER_LINE}{" "}
          <Link href="/guide" className="ap-link underline">
            راهنما و دامنهٔ پوشش
          </Link>
        </p>
      </div>


      {/* مدال مکالمه صوتی زنده با همگام‌سازی کامل به صفحه چت */}
      {isLiveAudioOpen && (
      <LiveVoiceModal
        isOpen={isLiveAudioOpen}
        onClose={() => setIsLiveAudioOpen(false)}
        conversationId={conversationId}
        onConversationIdChange={(id) => setConversationId(id)}
        onNewMessage={(userText, aiReply, draft, prob) => {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: userText },
            {
              role: "assistant",
              content: aiReply,
              draft: draft,
              probability: prob,
            },
          ]);
        }}
        onTriggerLegalDraft={(_type, _title, prompt) => {
          handleSendMessage(prompt);
        }}
      />
      )}
    </div>
  );
}

export default ChatShell;
