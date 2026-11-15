import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { loadAiDataPolicy } from '../../ai_policy/ai-data-policy';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { OPENROUTER_CHAT_COMPLETIONS_URL } from '../../data_import/constants/data-import.constants';
import {
  ASSISTANT_LLM_TIMEOUT_MS,
  ASSISTANT_MAX_FREE_ATTEMPTS,
  ASSISTANT_MAY_LOG_ROLES,
  ASSISTANT_MODEL_ROLES,
} from '../constants/assistant.constants';
import { AssistantToolDefinition } from './assistant-tools.service';

/** فراخوانی ابزار درخواستی مدل (قالب OpenAI). */
export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** پیام گفت‌وگو در قالب chat-completions. */
export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** پاسخ یک دور مدل همراه با آمار توکن و برچسب مسیریابی داده. */
export interface LlmTurn {
  model: string;
  content: string | null;
  toolCalls: LlmToolCall[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  customerDataFallback?: boolean;
}

/** مدل نامزد همراه با نقش آن در `config/models.yaml`. */
export interface ModelCandidate {
  id: string;
  role: string;
}

export interface KeyPoolProviderInfo {
  tier: string;
  customerData: 'allowed' | 'forbidden';
}

/** گزینه‌های اختیاری درخواست دور گفت‌وگو. */
export interface CompleteOptions {
  dataClass?: 'customer_data' | 'standard';
  strictCustomerData?: boolean;
}

/** خطای اختصاصی عدم دسترسی به استخرهای مجاز داده مشتری هنگام غیرفعال بودن fallback رایگان. */
export class CustomerDataDegradedException extends Error {
  constructor(message = 'هیچ استخر مجاز داده مشتری در دسترس نیست.') {
    super(message);
    this.name = 'CustomerDataDegradedException';
  }
}

interface OpenRouterToolResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: LlmToolCall[] };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * همه شناسه‌های مدل یک نقش از متن `config/models.yaml` به ترتیب فایل.
 * تجزیه سبک و هدفمند (بدون وابستگی YAML)، همانند `readRoleModelId`.
 */
export function readRoleModelIds(yamlText: string, role: string): string[] {
  const ids: string[] = [];
  let inRole = false;
  for (const raw of yamlText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) {
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();
    if (indent <= 2) {
      // کلید هم‌سطح نقش‌ها یا بخش دیگری از فایل: شروع/پایان نقش.
      const roleMatch = /^([A-Za-z0-9_]+):\s*$/.exec(trimmed);
      inRole = indent === 2 && roleMatch?.[1] === role;
      continue;
    }
    if (inRole) {
      const idMatch = /^-\s*id:\s*(\S+)\s*$/.exec(trimmed);
      if (idMatch) {
        ids.push(idMatch[1].replace(/^['"]|['"]$/g, ''));
      }
    }
  }
  return ids;
}

/** فهرست مدل‌های نامزد: نقش رایگان اول، سپس نقش پولی (AGENTS.md §4). */
export function buildCandidates(yamlText: string): ModelCandidate[] {
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];
  for (const role of ASSISTANT_MODEL_ROLES) {
    for (const id of readRoleModelIds(yamlText, role)) {
      if (!seen.has(id)) {
        seen.add(id);
        candidates.push({ id, role });
      }
    }
  }
  return candidates;
}

/** تجزیه ارائه‌دهندگان استخر کلیدها از config/key_pool.yaml برای خواندن وضعیت customer_data. */
export function parseKeyPoolProviders(yamlText: string): Record<string, KeyPoolProviderInfo> {
  const providers: Record<string, KeyPoolProviderInfo> = {};
  let inProviders = false;
  let currentProvider: string | null = null;
  let currentTier = 'free';
  let currentCustomerData: 'allowed' | 'forbidden' = 'forbidden';

  for (const raw of yamlText.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (indent === 0) {
      if (trimmed === 'providers:') {
        inProviders = true;
      } else if (inProviders) {
        if (currentProvider) {
          providers[currentProvider] = { tier: currentTier, customerData: currentCustomerData };
        }
        inProviders = false;
        currentProvider = null;
      }
      continue;
    }

    if (inProviders) {
      if (indent === 2 && trimmed.endsWith(':')) {
        if (currentProvider) {
          providers[currentProvider] = { tier: currentTier, customerData: currentCustomerData };
        }
        currentProvider = trimmed.slice(0, -1);
        currentTier = 'free';
        currentCustomerData = 'forbidden';
      } else if (currentProvider && indent >= 4) {
        const tierMatch = /^tier:\s*(\S+)/.exec(trimmed);
        if (tierMatch) {
          currentTier = tierMatch[1];
        }
        const cdMatch = /^customer_data:\s*(\S+)/.exec(trimmed);
        if (cdMatch) {
          currentCustomerData = cdMatch[1] === 'allowed' ? 'allowed' : 'forbidden';
        }
      }
    }
  }
  if (inProviders && currentProvider) {
    providers[currentProvider] = { tier: currentTier, customerData: currentCustomerData };
  }
  return providers;
}

/** تا `maxFree` مدل رایگان، سپس همه مدل‌های پولی (جایگزین پولی هرگز حذف نمی‌شود). */
export function selectAttempts(
  candidates: ModelCandidate[],
  maxFree: number = ASSISTANT_MAX_FREE_ATTEMPTS,
): ModelCandidate[] {
  const free = candidates
    .filter((candidate) => ASSISTANT_MAY_LOG_ROLES.has(candidate.role))
    .slice(0, maxFree);
  const paid = candidates.filter(
    (candidate) => !ASSISTANT_MAY_LOG_ROLES.has(candidate.role),
  );
  return [...free, ...paid];
}

/**
 * کلاینت مدل زبانی دستیار با function-calling روی درگاه LiteLLM و مسیر مستقیم OpenRouter.
 *
 * طبق T108 و الحاقیه ۲ (T136):
 * ۱. ابتدا در صورت پیکربندی درگاه LiteLLM Gateway (با برچسب customer_data) امتحان می‌شود.
 * ۲. در صورت در دسترس نبودن درگاه، مسیر مستقیم OpenRouter اجرا می‌شود.
 * ۳. مدل‌های رایگان ابتدا امتحان می‌شوند (طبق تصمیم مالک در AGENTS.md §4) و در صورت عدم پاسخگویی،
 *    مدل‌های پولی با data_collection=deny صدا زده می‌شوند.
 * ۴. در صورت فعال بودن بررسی اکید داده مشتری و غیرفعال بودن CUSTOMER_DATA_FREE_FALLBACK=false،
 *    مدل‌های رایگان منع می‌شوند و در صورت عدم دسترسی به مدل پولی، خطای تنزل به جدول پرتاب می‌شود.
 */
@Injectable()
export class AssistantLlmService {
  private readonly logger = new Logger(AssistantLlmService.name);
  private cachedCandidates: ModelCandidate[] | null = null;

  constructor(private readonly config: ConfigService) {}

  /** یک دور گفت‌وگو؛ استخرها و مدل‌ها به ترتیب قوانین حریم داده امتحان می‌شوند. */
  async complete(
    messages: LlmMessage[],
    tools: AssistantToolDefinition[],
    toolChoice: 'auto' | 'none' = 'auto',
    deadlineAt?: number,
    options?: CompleteOptions,
  ): Promise<LlmTurn> {
    const startMs = Date.now();
    const remaining = (): number =>
      deadlineAt === undefined ? Infinity : deadlineAt - Date.now();

    if (remaining() <= 0) {
      this.logger.warn('مهلت کل پرسش دستیار تمام شد.');
      throw new ServiceUnavailableException('مهلت پاسخگویی دستیار به پایان رسید.');
    }

    // ۱. بررسی درگاه LiteLLM Gateway
    const gatewayUrl = (
      this.config.get<string>('KEYPOOL_URL', '') ||
      this.config.get<string>('LITELLM_URL', '') ||
      this.config.get<string>('SMARTJUDGE_LLM_GATEWAY', '')
    ).trim().replace(/\/+$/, '');

    const gatewayMasterKey = (
      this.config.get<string>('KEYPOOL_MASTER_KEY', '') ||
      this.config.get<string>('LITELLM_API_KEY', '')
    ).trim();

    if (gatewayUrl && remaining() > 0) {
      try {
        const turn = await this.requestGateway(
          gatewayUrl,
          gatewayMasterKey,
          messages,
          tools,
          toolChoice,
          Math.min(ASSISTANT_LLM_TIMEOUT_MS, remaining()),
        );
        return turn;
      } catch (error) {
        this.logger.warn(
          `درگاه LiteLLM پاسخ نداد، سوئیچ به مسیر مستقیم: ${(error as Error).message}`,
        );
      }
    }

    // ۲. مسیر مستقیم OpenRouter
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY', '').trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('دستیار هوشمند پیکربندی نشده است.');
    }

    const freeFallbackAllowed =
      String(this.config.get<string>('CUSTOMER_DATA_FREE_FALLBACK', 'true')).toLowerCase() !== 'false';

    let candidates = selectAttempts(this.candidates());

    // اگر داده مشتری اکید باشد و fallback رایگان خاموش باشد، مدل‌های رایگان حذف می‌شوند
    if (options?.strictCustomerData || !freeFallbackAllowed) {
      candidates = candidates.filter((c) => !ASSISTANT_MAY_LOG_ROLES.has(c.role));
      if (candidates.length === 0) {
        this.logger.warn(
          'استخرهای مجاز داده مشتری در دسترس نیستند و CUSTOMER_DATA_FREE_FALLBACK غیرفعال است؛ تنزل به پاسخ جدول قطعی.',
        );
        throw new CustomerDataDegradedException(
          'هیچ مدل مجاز داده مشتری در دسترس نبود و fallback رایگان مسدود است.',
        );
      }
    }

    for (const candidate of candidates) {
      if (remaining() <= 0) {
        this.logger.warn('مهلت کل پرسش دستیار تمام شد.');
        break;
      }
      try {
        const turn = await this.request(
          apiKey,
          candidate,
          messages,
          tools,
          toolChoice,
          Math.min(ASSISTANT_LLM_TIMEOUT_MS, remaining()),
        );
        const isFree = ASSISTANT_MAY_LOG_ROLES.has(candidate.role);
        if (isFree) {
          turn.customerDataFallback = true;
        }
        return turn;
      } catch (error) {
        this.logger.warn(
          `مدل ${candidate.id} پاسخ نداد: ${(error as Error).message}`,
        );
      }
    }

    if (!freeFallbackAllowed || options?.dataClass === 'customer_data') {
      throw new CustomerDataDegradedException('تمام مدل‌های مجاز داده مشتری خطا دادند.');
    }

    throw new ServiceUnavailableException(
      'هیچ مدلی در دسترس نبود. چند دقیقه دیگر دوباره تلاش کنید.',
    );
  }

  private async requestGateway(
    gatewayUrl: string,
    masterKey: string,
    messages: LlmMessage[],
    tools: AssistantToolDefinition[],
    toolChoice: 'auto' | 'none',
    timeoutMs: number,
  ): Promise<LlmTurn> {
    const modelGroup = this.config.get<string>('KEYPOOL_MODEL', 'agent-strong-free');
    const endpoint = `${gatewayUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (masterKey) {
      headers.Authorization = `Bearer ${masterKey}`;
    }

    const body: Record<string, unknown> = {
      model: modelGroup,
      temperature: 0,
      messages,
      tools,
      tool_choice: toolChoice,
      metadata: {
        customer_data: 'true',
        feature: 'assistant',
      },
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as OpenRouterToolResponse;
    const message = payload?.choices?.[0]?.message;
    if (!message) {
      throw new Error('پاسخ خالی از درگاه');
    }
    const toolCalls =
      toolChoice === 'auto' && Array.isArray(message.tool_calls)
        ? message.tool_calls
        : [];
    const content =
      typeof message.content === 'string' && message.content.trim()
        ? message.content
        : null;
    if (!content && toolCalls.length === 0) {
      throw new Error('پاسخ بدون متن و ابزار از درگاه');
    }

    const turn: LlmTurn = {
      model: modelGroup,
      content,
      toolCalls,
      customerDataFallback: false,
    };
    if (payload.usage?.prompt_tokens !== undefined) {
      turn.promptTokens = payload.usage.prompt_tokens;
    }
    if (payload.usage?.completion_tokens !== undefined) {
      turn.completionTokens = payload.usage.completion_tokens;
    }
    if (payload.usage?.total_tokens !== undefined) {
      turn.totalTokens = payload.usage.total_tokens;
    }
    return turn;
  }

  private async request(
    apiKey: string,
    candidate: ModelCandidate,
    messages: LlmMessage[],
    tools: AssistantToolDefinition[],
    toolChoice: 'auto' | 'none',
    timeoutMs: number,
  ): Promise<LlmTurn> {
    const body: Record<string, unknown> = {
      model: candidate.id,
      temperature: 0,
      messages,
      tools,
      tool_choice: toolChoice,
    };
    if (!ASSISTANT_MAY_LOG_ROLES.has(candidate.role)) {
      body.provider = { data_collection: 'deny' };
    }

    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json()) as OpenRouterToolResponse;
    const message = payload?.choices?.[0]?.message;
    if (!message) {
      throw new Error('پاسخ خالی');
    }
    const toolCalls =
      toolChoice === 'auto' && Array.isArray(message.tool_calls)
        ? message.tool_calls
        : [];
    const content =
      typeof message.content === 'string' && message.content.trim()
        ? message.content
        : null;
    if (!content && toolCalls.length === 0) {
      throw new Error('پاسخ بدون متن و ابزار');
    }

    const turn: LlmTurn = {
      model: candidate.id,
      content,
      toolCalls,
    };
    if (payload.usage?.prompt_tokens !== undefined) {
      turn.promptTokens = payload.usage.prompt_tokens;
    }
    if (payload.usage?.completion_tokens !== undefined) {
      turn.completionTokens = payload.usage.completion_tokens;
    }
    if (payload.usage?.total_tokens !== undefined) {
      turn.totalTokens = payload.usage.total_tokens;
    }
    return turn;
  }

  /** مدل‌های نامزد از `config/models.yaml` (یک‌بار خوانده و نگه داشته می‌شود). */
  private candidates(): ModelCandidate[] {
    if (this.cachedCandidates) {
      return this.cachedCandidates;
    }
    const paths = this.modelConfigPaths();
    // The assistant sees tenant accounting data through its tools: only providers the policy allows.
    const policy = loadAiDataPolicy(paths);
    for (const file of paths) {
      try {
        const found = policy.filterModels('tenant-business', buildCandidates(fs.readFileSync(file, 'utf8')));
        if (found.length > 0) {
          this.cachedCandidates = found;
          return found;
        }
      } catch {
        // فایل ناموجود/غیرقابل‌خواندن: گزینه بعدی.
      }
    }
    throw new ServiceUnavailableException(
      'مدل‌های نقش free/cheap در config/models.yaml یافت نشد.',
    );
  }

  /** مسیرهای نامزد برای فایل رجیستری مدل‌ها (همانند سرویس‌های ورود داده). */
  private modelConfigPaths(): string[] {
    const candidates: string[] = [];
    const explicit = this.config.get<string>('MODELS_CONFIG_PATH');
    if (explicit) {
      candidates.push(explicit);
    }
    candidates.push(
      path.resolve(process.cwd(), 'config/models.yaml'),
      path.resolve(process.cwd(), '../../config/models.yaml'),
      path.resolve(__dirname, '../../../../../config/models.yaml'),
      path.resolve(__dirname, '../../../../../../config/models.yaml'),
      // Production: the repo root is mounted read-only (docker-compose.prod.yml).
      '/opt/roxira_platform/config/models.yaml',
    );
    return candidates;
  }
}
