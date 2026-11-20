import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
// Shared key pool (chmod 600). loadEnvFile never overrides, so .env values win.
const secretsFile = (process.env.SECRETS_ENV_FILE ?? path.join(process.env.HOME ?? '', 'Secrets/roxira/roxira.env')).trim();
if (secretsFile && fs.existsSync(secretsFile)) process.loadEnvFile(secretsFile);

const str = (k: string, d = '') => (process.env[k] ?? d).trim();
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};

/** Reads the primary model ID for a role from config/models.yaml without external YAML dependencies (T161). */
export function loadRoleModel(role: string): string {
  // MODELS_YAML: deployed copies (e.g. roxira-ci /srv/data/phone/agent) live outside the repo tree.
  const yamlPath = (process.env.MODELS_YAML ?? '').trim() || path.resolve(ROOT, '../../config/models.yaml');
  if (!fs.existsSync(yamlPath)) {
    throw new Error(`Model registry not found at ${yamlPath}`);
  }
  const text = fs.readFileSync(yamlPath, 'utf8');
  const lines = text.split(/\r?\n/);
  let inRole = false;
  for (const raw of lines) {
    const withoutComment = raw.replace(/#.*$/, '');
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = withoutComment.trim();
    const roleMatch = /^([A-Za-z0-9_]+):\s*$/.exec(trimmed);
    if (roleMatch && indent === 2) {
      inRole = roleMatch[1] === role;
      continue;
    }
    if (inRole) {
      const idMatch = /^-\s*id:\s*(\S+)\s*$/.exec(trimmed);
      if (idMatch) {
        return idMatch[1].replace(/^['"]|['"]$/g, '');
      }
    }
  }
  throw new Error(`Missing model id for role "${role}" in ${yamlPath}`);
}

const defaultOpenaiSttModel = loadRoleModel('stt_openai').replace(/^openai\//, '');
const defaultOpenaiTtsModel = loadRoleModel('tts_openai').replace(/^openai\//, '');

export const cfg = {
  root: ROOT,
  cacheDir: path.resolve(ROOT, str('CACHE_DIR', 'cache')),

  livekitHttp: str('LIVEKIT_URL', 'http://127.0.0.1:7880'),
  livekitWs: str('LIVEKIT_WS_URL', 'ws://127.0.0.1:7880'),
  livekitKey: str('LIVEKIT_API_KEY'),
  livekitSecret: str('LIVEKIT_API_SECRET'),
  roomPrefix: str('ROOM_PREFIX', 'call-'),
  sipIdentityPrefix: str('SIP_IDENTITY_PREFIX', 'sip_'),
  agentIdentity: str('AGENT_IDENTITY', 'ai-agent-bot'),

  // Only for blocked foreign APIs (STT/TTS/LLM). Never used for LiveKit or Smart Judge.
  proxyUrl: str('PROXY_URL', 'http://127.0.0.1:10808'),

  sttProvider: str('STT_PROVIDER', 'groq') as 'groq' | 'openai' | 'smartjudge',
  // all Groq keys from the pool, rotated on 429/5xx
  groqKeys: ['GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4'].map((k) => str(k)).filter(Boolean),
  // whisper-large-v3 beat -turbo on simulated Persian phone audio (CER 0.046 vs 0.058, +60 ms), 2026-11-15
  groqSttModel: str('GROQ_STT_MODEL', 'whisper-large-v3'),
  // hybrid = Whisper + Gemini in parallel (Whisper gates noise, Gemini text wins); whisper = Whisper only
  sttMode: str('STT_MODE', 'hybrid') as 'hybrid' | 'whisper',
  // Gemini hears real phone Persian much better than Whisper, but on heavy noise it invents a plausible
  // question instead of returning nothing - so Whisper's confidence always decides "speech or noise".
  geminiKeys: ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4'].map((k) => str(k)).filter(Boolean),
  // All run in parallel, each on its own key; the first id is preferred. 3-flash-preview was exact on the
  // real 2026-11-15 call ("آخرین آرای ...", 1.8-4.6 s), so it runs twice to cut its slow tail;
  // 3.5-flash-lite (~1.2 s) is the fast backup but heard "آخر رای", which the brain read as a definition question.
  geminiSttModels: str('GEMINI_STT_MODELS', 'gemini-3-flash-preview,gemini-3-flash-preview,gemini-3.5-flash-lite')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // max wait (from end of speech) for the preferred model; 3-flash-preview took 3.2-4.5 s on all 4 keys
  // (2026-11-15). After that a backup that already answered, else Whisper's own text.
  geminiWaitMs: num('GEMINI_WAIT_MS', 4800),
  geminiSttPrompt: str('GEMINI_STT_PROMPT', 'Transcribe this Persian phone call verbatim in Persian script. '
    + 'The caller is asking an Iranian legal question; typical terms: آرای وحدت رویه، دادنامه، تجدیدنظرخواهی، '
    + 'مهریه، چک برگشتی، دیوان عالی کشور، قانون مدنی، ماده، تبصره. Write what was said, do not correct or '
    + 'complete it. Output only the transcript. If there is no clearly intelligible speech, output nothing.'),
  openaiKey: str('OPENAI_API_KEY'),
  openaiSttModel: str('OPENAI_STT_MODEL', defaultOpenaiSttModel),
  // Whisper vocabulary hint (keep under ~220 tokens). Terms come from real phone-call misrecognitions.
  sttPrompt: str('STT_PROMPT', 'پرسش حقوقی تلفنی: مهلت تجدیدنظرخواهی، آرای وحدت رویه، دادنامه، واخواهی، فرجام‌خواهی، '
    + 'دادخواست، دادسرا، بازپرس، شورای حل اختلاف، دیوان عالی کشور، دیوان عدالت اداری، اجرای احکام، '
    + 'مهریه، نفقه، اعسار، طلاق توافقی، حضانت، ارث، انحصار وراثت، چک برگشتی، سفته، قولنامه، '
    + 'سند رسمی، اجاره‌نامه، تخلیه، دیه، قانون مدنی، آیین دادرسی، ماده، تبصره.'),

  ttsProvider: str('TTS_PROVIDER', 'edge') as 'edge' | 'openai' | 'smartjudge',
  edgeTtsUrl: str('EDGE_TTS_URL', 'http://127.0.0.1:5055'),
  ttsVoice: str('TTS_VOICE', 'fa-IR-FaridNeural'),
  ttsRate: str('TTS_RATE', '+8%'),
  openaiTtsModel: str('OPENAI_TTS_MODEL', defaultOpenaiTtsModel),
  openaiTtsVoice: str('OPENAI_TTS_VOICE', 'nova'),

  judgeBase: str('SMARTJUDGE_BASE', 'https://ghazihoushmand.ir/api/v1/apps/judge').replace(/\/$/, ''),
  judgeToken: str('SMARTJUDGE_TOKEN'),
  // phone-line service identity (PR #799): own daily cap + paid fallback on the server
  judgeGatewayKey: str('SMARTJUDGE_PHONE_GATEWAY_KEY'),
  judgeTimeoutMs: num('SMARTJUDGE_TIMEOUT_MS', 45000),

  vadStartMs: num('VAD_START_MS', 160),
  vadEndSilenceMs: num('VAD_END_SILENCE_MS', 600),
  vadMinUtteranceMs: num('VAD_MIN_UTTERANCE_MS', 350),
  vadMaxUtteranceMs: num('VAD_MAX_UTTERANCE_MS', 20000),
  vadEnergyRatio: num('VAD_ENERGY_RATIO', 3.0),
  vadMinRms: num('VAD_MIN_RMS', 350),
  bargeInMs: num('BARGE_IN_MS', 300),
  // Semantic end of turn: when the transcript looks unfinished ("... که", "... در مورد"),
  // wait this much longer for the caller to go on before answering.
  turnHoldMs: num('TURN_HOLD_MS', 1200),
  // Short "one moment" if no answer audio has started this long after the caller stopped talking
  // (never right at end of speech; speech that resumes during it is merged into the same turn).
  fillerDelayMs: num('FILLER_DELAY_MS', 2000),
  // Whisper confidence floor (duration-weighted avg_logprob). Below it the caller is asked to
  // repeat instead of the brain answering a guess. Calibrated 2026-11-15 on noisy phone clips:
  // usable transcripts -0.05..-0.45, garbage -0.83..-0.92.
  sttMinLogprob: num('STT_MIN_LOGPROB', -0.7),
  // Testing only: caller identities (comma list, e.g. sip_+98912...) whose turns are saved as WAV
  // under DEBUG_RECORD_DIR for STT tuning; files older than 48 h are deleted. Empty = never record.
  debugRecordCallers: str('DEBUG_RECORD_CALLERS').split(',').map((s) => s.trim()).filter(Boolean),
  debugRecordDir: path.resolve(ROOT, str('DEBUG_RECORD_DIR', 'debug-audio')),

  maxConcurrentCalls: num('MAX_CONCURRENT_CALLS', 3),
  maxCallSeconds: num('MAX_CALL_SECONDS', 900),
  idleHangupSeconds: num('IDLE_HANGUP_SECONDS', 60),
  pollMs: num('POLL_MS', 700),

  greetingText: str('GREETING_TEXT',
    'سلام، به سامانه هوشمند قاضی هوشمند خوش آمدید. لطفاً توجه داشته باشید که این پاسخ‌ها مشاوره اولیه است و جایگزین وکیل نیست. بفرمایید سوالتان چیست؟'),
  fillerText: str('FILLER_TEXT', 'بله، یک لحظه.'),
  repeatText: str('REPEAT_TEXT', 'ببخشید، صدایتان واضح نرسید. لطفاً سؤالتان را کامل بفرمایید.'),
  errorText: str('ERROR_TEXT', 'متأسفانه الان پاسخ آماده نشد. لطفاً سؤال‌تان را دوباره بپرسید.'),
  busyText: str('BUSY_TEXT', 'همه خطوط مشغول است. لطفاً چند دقیقه دیگر دوباره تماس بگیرید. خدانگهدار.'),
  goodbyeText: str('GOODBYE_TEXT', 'از تماس شما سپاسگزاریم. خدانگهدار.'),
};

export type Cfg = typeof cfg;

export function validateConfig(c: Cfg = cfg): void {
  if (!c.livekitKey || !c.livekitSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  }
  if (!c.judgeGatewayKey && !c.judgeToken) {
    throw new Error('SMARTJUDGE_PHONE_GATEWAY_KEY (or SMARTJUDGE_TOKEN) must be set');
  }
}
