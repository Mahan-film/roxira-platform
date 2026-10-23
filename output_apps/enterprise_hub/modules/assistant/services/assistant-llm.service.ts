import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

/** پاسخ یک دور مدل. */
export interface LlmTurn {
  model: string;
  content: string | null;
  toolCalls: LlmToolCall[];
}

/** مدل نامزد همراه با نقش آن در `config/models.yaml`. */
export interface ModelCandidate {
  id: string;
  role: string;
}

interface OpenRouterToolResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: LlmToolCall[] };
  }>;
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
 * کلاینت مدل زبانی دستیار با function-calling روی OpenRouter.
 *
 * شناسه مدل‌ها فقط از نقش‌های `free` و سپس `cheap` در `config/models.yaml`
 * خوانده می‌شود (هیچ شناسه‌ای hardcode نیست) و کلید تنها از
 * `OPENROUTER_API_KEY` سمت سرور می‌آید. برای نقش پولی
 * `data_collection: deny` ارسال می‌شود.
 */
@Injectable()
export class AssistantLlmService {
  private readonly logger = new Logger(AssistantLlmService.name);
  private cachedCandidates: ModelCandidate[] | null = null;

  constructor(private readonly config: ConfigService) {}

  /** یک دور گفت‌وگو؛ مدل‌ها به ترتیب امتحان می‌شوند تا یکی پاسخ دهد. */
  async complete(
    messages: LlmMessage[],
    tools: AssistantToolDefinition[],
    toolChoice: 'auto' | 'none' = 'auto',
    deadlineAt?: number,
  ): Promise<LlmTurn> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY', '').trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('دستیار هوشمند پیکربندی نشده است.');
    }

    const candidates = selectAttempts(this.candidates());
    for (const candidate of candidates) {
      const remaining = deadlineAt === undefined ? Infinity : deadlineAt - Date.now();
      if (remaining <= 0) {
        this.logger.warn('مهلت کل پرسش دستیار تمام شد.');
        break;
      }
      try {
        return await this.request(
          apiKey,
          candidate,
          messages,
          tools,
          toolChoice,
          Math.min(ASSISTANT_LLM_TIMEOUT_MS, remaining),
        );
      } catch (error) {
        this.logger.warn(
          `مدل ${candidate.id} پاسخ نداد: ${(error as Error).message}`,
        );
      }
    }
    throw new ServiceUnavailableException(
      'هیچ مدلی در دسترس نبود. چند دقیقه دیگر دوباره تلاش کنید.',
    );
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
    return { model: candidate.id, content, toolCalls };
  }

  /** مدل‌های نامزد از `config/models.yaml` (یک‌بار خوانده و نگه داشته می‌شود). */
  private candidates(): ModelCandidate[] {
    if (this.cachedCandidates) {
      return this.cachedCandidates;
    }
    for (const file of this.modelConfigPaths()) {
      try {
        const found = buildCandidates(fs.readFileSync(file, 'utf8'));
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
