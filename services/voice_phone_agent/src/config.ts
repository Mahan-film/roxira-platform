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
  openaiKey: str('OPENAI_API_KEY'),
  openaiSttModel: str('OPENAI_STT_MODEL', 'whisper-1'),
  // Whisper vocabulary hint (keep under ~220 tokens). Terms come from real phone-call misrecognitions.
  sttPrompt: str('STT_PROMPT', 'پرسش حقوقی تلفنی: مهلت تجدیدنظرخواهی، آرای وحدت رویه، دادنامه، واخواهی، فرجام‌خواهی، '
    + 'دادخواست، دادسرا، بازپرس، شورای حل اختلاف، دیوان عالی کشور، دیوان عدالت اداری، اجرای احکام، '
    + 'مهریه، نفقه، اعسار، طلاق توافقی، حضانت، ارث، انحصار وراثت، چک برگشتی، سفته، قولنامه، '
    + 'سند رسمی، اجاره‌نامه، تخلیه، دیه، قانون مدنی، آیین دادرسی، ماده، تبصره.'),

  ttsProvider: str('TTS_PROVIDER', 'edge') as 'edge' | 'openai' | 'smartjudge',
  edgeTtsUrl: str('EDGE_TTS_URL', 'http://127.0.0.1:5055'),
  ttsVoice: str('TTS_VOICE', 'fa-IR-FaridNeural'),
  ttsRate: str('TTS_RATE', '+8%'),
  openaiTtsModel: str('OPENAI_TTS_MODEL', 'tts-1'),
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
  // Short "one moment" only if no answer audio has started by then (never right at end of speech).
  fillerDelayMs: num('FILLER_DELAY_MS', 1800),
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
