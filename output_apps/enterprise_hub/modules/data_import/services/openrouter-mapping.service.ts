import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  CHEAP_MODEL_ROLE,
  CRM_LEAD_FIELDS,
  MAX_CELL_CHARS,
  MAX_SAMPLE_ROWS,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from '../constants/data-import.constants';

/** تنها نقش مجاز برای نگاشت ستون‌ها در `config/models.yaml`. */
export const ALLOWED_FIELDS = new Set<string>(CRM_LEAD_FIELDS);

/** بدنه درخواست چت‌تکمیل OpenRouter. */
export interface OpenRouterChatRequest {
  model: string;
  temperature: number;
  provider: { data_collection: 'deny' };
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * دستور سیستمی نگاشت ستون‌ها. مدل فقط سربرگ‌ها و حداکثر ۵ ردیف نمونه
 * (سلول‌های بریده‌شده) را می‌بیند و باید فقط یک شیء JSON برگرداند.
 */
const SYSTEM_PROMPT = [
  'You map spreadsheet column headers to CRM lead fields.',
  'Allowed target fields: fullName, email, phone, company, pipelineStage, estimatedValue, owner, notes.',
  'Return ONLY a JSON object mapping each source column header (exact string) to one allowed field.',
  'Omit columns that do not match. Do not add prose, markdown or extra keys.',
].join(' ');

/** بریدن مقدار سلول به حداکثر طول مجاز (پیش‌فرض ۴۰ نویسه). */
export function truncateCell(value: unknown, max = MAX_CELL_CHARS): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * ساخت بدنه درخواست LLM با محدودیت‌های سخت: حداکثر ۵ ردیف نمونه و بریدن هر
 * سلول به ۴۰ نویسه. این تابع خالص است تا در تست‌ها قابل بازبینی باشد.
 */
export function buildMappingRequestBody(
  model: string,
  headers: string[],
  sampleRows: string[][],
): OpenRouterChatRequest {
  const trimmedRows = sampleRows
    .slice(0, MAX_SAMPLE_ROWS)
    .map((row) => row.map((cell) => truncateCell(cell)));

  return {
    model,
    temperature: 0,
    provider: { data_collection: 'deny' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({ columns: headers, sampleRows: trimmedRows }),
      },
    ],
  };
}

/**
 * استخراج نخستین شناسه مدل یک نقش از متن `config/models.yaml`.
 * تجزیه سبک و هدفمند (بدون وابستگی YAML) چون فقط به شناسه نقش نیاز است.
 */
export function readRoleModelId(yamlText: string, role: string): string | null {
  const lines = yamlText.split(/\r?\n/);
  let inRole = false;

  for (const raw of lines) {
    const withoutComment = raw.replace(/#.*$/, '');
    if (!withoutComment.trim()) {
      continue;
    }
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
  return null;
}

/** شناسه مدل نقش `cheap` (نگاشت ستون‌ها) از متن `config/models.yaml`. */
export function readCheapModelId(yamlText: string): string | null {
  return readRoleModelId(yamlText, CHEAP_MODEL_ROLE);
}

/** استخراج شیء JSON از پاسخ مدل (پاک‌سازی بلوک code fence). */
function extractJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('پاسخ مدل شامل JSON معتبر نیست.');
  }
  const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('پاسخ مدل یک شیء JSON نیست.');
  }
  return parsed as Record<string, unknown>;
}

/** تبدیل پاسخ مدل به نگاشت معتبر و محدود به سربرگ‌ها/فیلدهای مجاز. */
export function parseMappingContent(
  content: string,
  headers: string[],
): Record<string, string> {
  const object = extractJsonObject(content);
  const headerSet = new Set(headers);
  const mapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(object)) {
    if (
      headerSet.has(key) &&
      typeof value === 'string' &&
      ALLOWED_FIELDS.has(value)
    ) {
      mapping[key] = value;
    }
  }
  return mapping;
}

/** دستور سیستمی تشخیص موجودیت از روی سربرگ‌ها (فقط کلید معتبر مجاز است). */
export const ENTITY_CHOICE_PROMPT = [
  'You classify a spreadsheet by its column headers.',
  'Return ONLY a JSON object {"entity": "<one of the given keys>"}.',
  'If unsure, return {"entity": null}. Do not add prose or markdown.',
].join(' ');

/** ساخت بدنه درخواست تشخیص موجودیت با محدودیت‌های مشترک (۵ ردیف/۴۰ نویسه). */
export function buildEntityChoiceRequestBody(
  model: string,
  entities: ReadonlyArray<{ key: string; labelFa: string }>,
  headers: string[],
  sampleRows: string[][],
): OpenRouterChatRequest {
  const trimmedRows = sampleRows
    .slice(0, MAX_SAMPLE_ROWS)
    .map((row) => row.map((cell) => truncateCell(cell)));

  return {
    model,
    temperature: 0,
    provider: { data_collection: 'deny' },
    messages: [
      { role: 'system', content: ENTITY_CHOICE_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          entities: entities.map((entity) => ({
            key: entity.key,
            label: entity.labelFa,
          })),
          columns: headers,
          sampleRows: trimmedRows,
        }),
      },
    ],
  };
}

/** ساخت بدنه درخواست نگاشت ستون برای فیلدهای یک موجودیت دلخواه. */
export function buildGenericMappingRequestBody(
  model: string,
  fields: ReadonlyArray<{ key: string; labelFa: string }>,
  headers: string[],
  sampleRows: string[][],
): OpenRouterChatRequest {
  const allowed = fields.map((field) => field.key).join(', ');
  const systemPrompt = [
    'You map spreadsheet column headers to the target entity fields.',
    `Allowed target fields: ${allowed}.`,
    'Return ONLY a JSON object mapping each source column header (exact string) to one allowed field.',
    'Omit columns that do not match. Do not add prose, markdown or extra keys.',
  ].join(' ');

  const trimmedRows = sampleRows
    .slice(0, MAX_SAMPLE_ROWS)
    .map((row) => row.map((cell) => truncateCell(cell)));

  return {
    model,
    temperature: 0,
    provider: { data_collection: 'deny' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: JSON.stringify({ columns: headers, sampleRows: trimmedRows }),
      },
    ],
  };
}

/** تبدیل پاسخ مدل به نگاشت معتبر برای فهرست فیلدهای مجاز. */
export function parseMappingForFields(
  content: string,
  headers: string[],
  allowedFields: readonly string[],
): Record<string, string> {
  const object = extractJsonObject(content);
  const headerSet = new Set(headers);
  const allowed = new Set(allowedFields);
  const mapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(object)) {
    if (
      headerSet.has(key) &&
      typeof value === 'string' &&
      allowed.has(value)
    ) {
      mapping[key] = value;
    }
  }
  return mapping;
}

/** استخراج کلید موجودیت انتخاب‌شده توسط مدل (یا `null`). */
export function parseEntityChoice(
  content: string,
  keys: readonly string[],
): string | null {
  const object = extractJsonObject(content);
  const value = object.entity;
  if (typeof value === 'string' && keys.includes(value)) {
    return value;
  }
  return null;
}

/**
 * سرویس نگاشت ستون‌ها با OpenRouter (تنها درگاه LLM مجاز).
 *
 * مدل از نقش `cheap` در `config/models.yaml` خوانده می‌شود (هیچ شناسه‌ای
 * hardcode نمی‌شود)، کلید فقط از `OPENROUTER_API_KEY` سروری می‌آید و بدنه
 * درخواست همواره `provider.data_collection: "deny"` دارد. هر خطا به سمت
 * نگاشت قطعی (fallback) منتقل می‌شود.
 */
@Injectable()
export class OpenRouterMappingService {
  private readonly logger = new Logger(OpenRouterMappingService.name);

  constructor(private readonly config: ConfigService) {}

  /** ارسال سربرگ‌ها + حداکثر ۵ ردیف نمونه به مدل و دریافت نگاشت پیشنهادی. */
  async proposeMapping(
    headers: string[],
    sampleRows: string[][],
  ): Promise<Record<string, string>> {
    if (headers.length === 0) {
      return {};
    }

    const apiKey = this.config
      .get<string>('OPENROUTER_API_KEY', '')
      .trim();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY پیکربندی نشده است.');
    }

    const model = this.resolveModelId();
    const body = buildMappingRequestBody(model, headers, sampleRows);

    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`درخواست OpenRouter ناموفق بود (HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as OpenRouterChatResponse;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('پاسخ مدل خالی است.');
    }

    return parseMappingContent(content, headers);
  }

  /**
   * نگاشت ستون‌ها برای یک موجودیت دلخواه رجیستری.
   * فقط سربرگ‌ها و حداکثر ۵ ردیف نمونه (سلول‌های بریده‌شده) ارسال می‌شود.
   */
  async proposeMappingForFields(
    headers: string[],
    sampleRows: string[][],
    fields: ReadonlyArray<{ key: string; labelFa: string }>,
  ): Promise<Record<string, string>> {
    if (headers.length === 0 || fields.length === 0) {
      return {};
    }

    const model = this.resolveModelId();
    const body = buildGenericMappingRequestBody(
      model,
      fields,
      headers,
      sampleRows,
    );
    const content = await this.requestCompletion(body);
    return parseMappingForFields(
      content,
      headers,
      fields.map((field) => field.key),
    );
  }

  /**
   * تشخیص موجودیت فایل با مدل زبانی (تنها وقتی امتیاز مترادف‌ها مبهم است).
   * فقط سربرگ‌ها و حداکثر ۵ ردیف نمونه ارسال و کلید انتخاب‌شده بازگردانده
   * می‌شود؛ در صورت نامعتبر بودن پاسخ `null`.
   */
  async proposeEntity(
    headers: string[],
    sampleRows: string[][],
    entities: ReadonlyArray<{ key: string; labelFa: string }>,
  ): Promise<string | null> {
    if (headers.length === 0 || entities.length === 0) {
      return null;
    }

    const model = this.resolveModelId();
    const body = buildEntityChoiceRequestBody(model, entities, headers, sampleRows);
    const content = await this.requestCompletion(body);
    return parseEntityChoice(
      content,
      entities.map((entity) => entity.key),
    );
  }

  /** ارسال بدنه چت‌تکمیل به OpenRouter و بازگرداندن محتوای پاسخ. */
  private async requestCompletion(
    body: OpenRouterChatRequest,
  ): Promise<string> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY', '').trim();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY پیکربندی نشده است.');
    }

    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`درخواست OpenRouter ناموفق بود (HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as OpenRouterChatResponse;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('پاسخ مدل خالی است.');
    }
    return content;
  }

  /** شناسه مدل نقش `cheap` از `config/models.yaml`. */
  private resolveModelId(): string {
    for (const candidate of this.modelConfigPaths()) {
      try {
        const text = fs.readFileSync(candidate, 'utf8');
        const id = readCheapModelId(text);
        if (id) {
          this.logger.debug(`مدل نگاشت: ${id} (${candidate})`);
          return id;
        }
      } catch {
        // فایل ناموجود/غیرقابل‌خواندن: گزینه بعدی.
      }
    }
    throw new Error('شناسه مدل نقش cheap در config/models.yaml یافت نشد.');
  }

  /** مسیرهای نامزد برای فایل رجیستری مدل‌ها. */
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
    );
    return candidates;
  }
}
