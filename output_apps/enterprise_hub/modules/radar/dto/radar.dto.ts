import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** بدنه درخواست اجرای زنده کاوشگر فناوری. */
export class TriggerScoutDto {
  @ApiProperty({
    example: 'latest 2026 open-source AI agent frameworks and fast speech-to-text models',
    description: 'موضوع پژوهش یا پرس‌وجوی کاوشگر زنده فناوری',
    minLength: 3,
    maxLength: 400,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(400)
  topic: string;

  @ApiPropertyOptional({
    example: false,
    description: 'حالت عمیق: پرس‌وجوها، صفحات خزیده و بودجه سنتز بیشتر',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deep?: boolean;
}

/** بدنه درخواست اجرای موازی استخر ۱۰ ایجنت. */
export class RunSwarmDto {
  @ApiPropertyOptional({
    example: 180,
    description: 'مهلت مجاز هر ایجنت بر حسب ثانیه (۱۰ تا ۶۰۰)',
    minimum: 10,
    maximum: 600,
    default: 180,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  timeoutSeconds?: number;
}

/** وضعیت یک ایجنت در استخر موازی. */
export class RadarAgentStatusDto {
  @ApiProperty({ example: 'agent-1-ai-audit' })
  id: string;

  @ApiProperty({ example: 'ممیزی موتورهای LLM' })
  label: string;

  @ApiProperty({ example: 'اتصال به درگاه OpenRouter و احراز کلید' })
  task: string;

  @ApiProperty({
    enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED'],
    example: 'SUCCESS',
  })
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

  @ApiPropertyOptional({ example: 1.42, nullable: true })
  elapsedSeconds?: number | null;

  @ApiPropertyOptional({ example: '', nullable: true })
  stderr?: string;
}

/** شمارش تجمیعی وضعیت ایجنت‌ها. */
export class RadarSwarmSummaryDto {
  @ApiProperty({ example: 10 })
  total: number;

  @ApiProperty({ example: 0 })
  running: number;

  @ApiProperty({ example: 9 })
  success: number;

  @ApiProperty({ example: 1 })
  failed: number;

  @ApiProperty({ example: 0 })
  pending: number;
}

/** وضعیت کامل اجرای ازدحام ۱۰ ایجنت. */
export class RadarSwarmStatusDto {
  @ApiPropertyOptional({ example: 'swarm-1726065000000', nullable: true })
  jobId?: string | null;

  @ApiProperty({
    enum: ['IDLE', 'RUNNING', 'COMPLETED', 'FAILED'],
    example: 'RUNNING',
  })
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

  @ApiPropertyOptional({ example: '2026-09-11T16:30:00.000Z', nullable: true })
  startedAt?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  finishedAt?: string | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  exitCode?: number | null;

  @ApiProperty({ type: [RadarAgentStatusDto] })
  agents: RadarAgentStatusDto[];

  @ApiProperty({ type: RadarSwarmSummaryDto })
  summary: RadarSwarmSummaryDto;
}

/** وضعیت کار پس‌زمینه کاوشگر زنده. */
export class RadarScoutStatusDto {
  @ApiPropertyOptional({ example: 'scout-1726065000000', nullable: true })
  jobId?: string | null;

  @ApiProperty({
    enum: ['IDLE', 'RUNNING', 'COMPLETED', 'FAILED'],
    example: 'RUNNING',
  })
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

  @ApiPropertyOptional({ example: 'AI agents 2026', nullable: true })
  topic?: string | null;

  @ApiProperty({ example: false })
  deep: boolean;

  @ApiPropertyOptional({ example: '2026-09-11T16:30:00.000Z', nullable: true })
  startedAt?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  finishedAt?: string | null;

  @ApiPropertyOptional({ example: 0, nullable: true })
  exitCode?: number | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  error?: string | null;

  @ApiProperty({ type: [String], example: ['[INFO] search: 42 results'] })
  log: string[];
}

/** پاسخ فراداده گزارش رادار فناوری (بدون محتوای حجیم). */
export class RadarReportMetaDto {
  @ApiProperty({ example: true })
  available: boolean;

  @ApiPropertyOptional({ example: 'latest 2026 AI agent frameworks' })
  topic?: string;

  @ApiPropertyOptional({ example: 'deep' })
  mode?: string;

  @ApiPropertyOptional({ example: '2026-09-11T16:17:38+00:00' })
  generatedAt?: string;

  @ApiPropertyOptional({ example: 0.82 })
  confidence?: number;

  @ApiPropertyOptional({ example: 10 })
  sourceCount?: number;

  @ApiPropertyOptional({ example: 'deepseek/deepseek-v4.1-flash' })
  model?: string;

  @ApiPropertyOptional({ example: 'SUCCESS' })
  status?: string;
}

/** پاسخ کامل رادار فناوری شامل داده ساختاریافته و مارک‌داون. */
export class RadarReportResponseDto extends RadarReportMetaDto {
  @ApiProperty({
    description: 'محتوای مارک‌داون TECH_RADAR_REPORT.md',
    example: '# 🛰️ گزارش رادار فناوری ROXIRA',
  })
  markdown: string;

  @ApiProperty({
    description: 'داده ساختاریافته استخراج‌شده از گزارش (JSON/پارس مارک‌داون)',
    type: 'object',
    additionalProperties: true,
  })
  structured: Record<string, unknown>;
}
