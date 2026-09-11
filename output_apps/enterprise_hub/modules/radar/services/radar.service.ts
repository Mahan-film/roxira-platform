import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  MAX_JOB_LOG_LINES,
  RADAR_PROJECT_ROOT_DEFAULT,
  SWARM_AGENTS,
  SWARM_DONE_PREFIX,
  SWARM_RUNNER_SCRIPT,
  SWARM_STREAM_PREFIX,
  TECH_RADAR_REPORT_JSON_FILENAME,
  TECH_RADAR_REPORT_MD_FILENAME,
  TECH_RADAR_SCRIPT,
} from '../constants/radar.constants';
import {
  RadarAgentStatusDto,
  RadarReportResponseDto,
  RadarScoutStatusDto,
  RadarSwarmStatusDto,
  RunSwarmDto,
  TriggerScoutDto,
} from '../dto/radar.dto';

/** وضعیت داخلی کار پس‌زمینه. */
type JobStatus = 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED';

/** شکل خروجی هر ایجنت در حالت stream اسکریپت ازدحام. */
interface SwarmAgentPayload {
  agent: string;
  task?: string;
  status?: string;
  time_sec?: number;
  stderr?: string;
}

/**
 * سرویس رادار فناوری و ارکستراسیون ازدحام ایجنت‌ها.
 *
 * - گزارش رسمی `TECH_RADAR_REPORT.md/.json` را از ریشه پروژه می‌خواند.
 * - کاوشگر زنده `src/automation/tech_radar.py` را با موضوع کاربر در
 *   پس‌زمینه اجرا می‌کند و لاگ زنده نگه می‌دارد.
 * - استخر موازی `src/automation/parallel_swarm_runner.py` را با حالت
 *   stream اجرا کرده و وضعیت ۱۰ ایجنت را به‌صورت لحظه‌ای به‌روزرسانی می‌کند.
 *
 * تمام منطق در این سرویس متمرکز است و کنترلر فقط مسیریابی HTTP انجام
 * می‌دهد (Rule #3 — AGENTS.md).
 */
@Injectable()
export class RadarService {
  private readonly logger = new Logger(RadarService.name);

  private readonly projectRoot: string;
  private readonly pythonBin: string;

  private scoutProcess: ChildProcessWithoutNullStreams | null = null;
  private scoutJob: RadarScoutStatusDto = this.emptyScoutJob();

  private swarmProcess: ChildProcessWithoutNullStreams | null = null;
  private swarmJob: RadarSwarmStatusDto = this.emptySwarmJob();

  constructor(private readonly config: ConfigService) {
    this.projectRoot = this.config.get<string>(
      'RADAR_PROJECT_ROOT',
      RADAR_PROJECT_ROOT_DEFAULT,
    );
    this.pythonBin = this.config.get<string>('PYTHON_BIN', 'python3');
  }

  // ---------------------------------------------------------------- report
  /** خواندن و بازگرداندن گزارش ساختاریافته رادار فناوری. */
  async getReport(): Promise<RadarReportResponseDto> {
    const mdPath = path.join(this.projectRoot, TECH_RADAR_REPORT_MD_FILENAME);
    const jsonPath = path.join(this.projectRoot, TECH_RADAR_REPORT_JSON_FILENAME);

    let markdown = '';
    try {
      markdown = await fs.readFile(mdPath, 'utf8');
    } catch {
      markdown = '';
    }

    let structured: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(jsonPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        structured = parsed as Record<string, unknown>;
      }
    } catch {
      structured = this.parseMarkdown(markdown);
    }

    if (!markdown && Object.keys(structured).length > 0) {
      markdown = this.renderStructured(structured);
    }

    const engine = structured.engine;
    const model =
      engine && typeof engine === 'object'
        ? (engine as Record<string, unknown>).synthesis_model
        : undefined;

    return {
      available: markdown.length > 0 || Object.keys(structured).length > 0,
      topic: this.asString(structured.topic),
      mode: this.asString(structured.mode),
      generatedAt: this.asString(structured.generated_at),
      confidence: this.asNumber(structured.confidence),
      sourceCount: this.asNumber(structured.source_count),
      model: this.asString(model),
      status: this.asString(structured.status),
      markdown,
      structured,
    };
  }

  // ------------------------------------------------------------- scout job
  /** اجرای زنده کاوشگر فناوری با موضوع کاربر در پس‌زمینه. */
  triggerScout(dto: TriggerScoutDto): RadarScoutStatusDto {
    if (this.scoutProcess) {
      return this.getScoutStatus();
    }

    const startedAt = new Date().toISOString();
    const args = [
      path.join(this.projectRoot, TECH_RADAR_SCRIPT),
      '--topic',
      dto.topic,
    ];
    if (dto.deep) {
      args.push('--deep');
    }

    this.scoutJob = {
      jobId: `scout-${Date.now()}`,
      status: 'RUNNING',
      topic: dto.topic,
      deep: dto.deep ?? false,
      startedAt,
      finishedAt: null,
      exitCode: null,
      error: null,
      log: [`topic=${dto.topic} deep=${dto.deep ?? false}`],
    };

    const child = spawn(this.pythonBin, args, {
      cwd: this.projectRoot,
      env: this.buildEnv(),
    });
    this.scoutProcess = child;

    this.attachLogs(child, this.scoutJob.log, '[tech-radar]');

    child.on('error', (error) => {
      this.scoutJob.status = 'FAILED';
      this.scoutJob.error = error.message;
      this.pushLog(this.scoutJob.log, `[error] ${error.message}`);
      this.scoutProcess = null;
    });

    child.on('close', (code) => {
      this.scoutJob.exitCode = code ?? -1;
      this.scoutJob.finishedAt = new Date().toISOString();
      this.scoutJob.status = code === 0 ? 'COMPLETED' : 'FAILED';
      if (code !== 0 && !this.scoutJob.error) {
        this.scoutJob.error = `اسکریپت با کد خروج ${code} پایان یافت.`;
      }
      this.scoutProcess = null;
      this.logger.log(`scout job finished with code ${code}`);
    });

    return this.getScoutStatus();
  }

  /** وضعیت جاری کاوشگر زنده. */
  getScoutStatus(): RadarScoutStatusDto {
    return { ...this.scoutJob, log: [...this.scoutJob.log] };
  }

  // ------------------------------------------------------------- swarm job
  /** اجرای موازی استخر ۱۰ ایجنت و بازگرداندن وضعیت لحظه‌ای. */
  runSwarm(dto: RunSwarmDto): RadarSwarmStatusDto {
    if (this.swarmProcess) {
      return this.getSwarmStatus();
    }

    const args = [
      path.join(this.projectRoot, SWARM_RUNNER_SCRIPT),
      '--stream',
    ];
    if (dto.timeoutSeconds) {
      args.push('--timeout', String(dto.timeoutSeconds));
    }

    this.swarmJob = {
      jobId: `swarm-${Date.now()}`,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      agents: SWARM_AGENTS.map((agent) =>
        this.toAgentStatus(agent.id, agent.label, agent.task, 'RUNNING'),
      ),
      summary: { total: SWARM_AGENTS.length, running: SWARM_AGENTS.length, success: 0, failed: 0, pending: 0 },
    };

    const child = spawn(this.pythonBin, args, {
      cwd: this.projectRoot,
      env: this.buildEnv(),
    });
    this.swarmProcess = child;

    const buffer = { value: '' };
    child.stdout.on('data', (chunk: Buffer) => {
      buffer.value += chunk.toString('utf8');
      const lines = buffer.value.split('\n');
      buffer.value = lines.pop() ?? '';
      for (const line of lines) {
        this.consumeSwarmLine(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.logger.warn(`swarm stderr: ${chunk.toString('utf8').slice(0, 300)}`);
    });

    child.on('error', (error) => {
      this.swarmJob.status = 'FAILED';
      this.swarmJob.finishedAt = new Date().toISOString();
      this.swarmJob.agents = this.swarmJob.agents.map((agent) =>
        agent.status === 'SUCCESS' ? agent : { ...agent, status: 'FAILED', stderr: error.message },
      );
      this.recomputeSwarmSummary();
      this.swarmProcess = null;
    });

    child.on('close', (code) => {
      this.swarmJob.exitCode = code ?? -1;
      this.swarmJob.finishedAt = new Date().toISOString();
      this.swarmJob.status = code === 0 ? 'COMPLETED' : 'FAILED';
      this.swarmJob.agents = this.swarmJob.agents.map((agent) =>
        agent.status === 'SUCCESS' || agent.status === 'FAILED'
          ? agent
          : { ...agent, status: 'FAILED', stderr: 'ایجنت بدون گزارش پایان یافت.' },
      );
      this.recomputeSwarmSummary();
      this.swarmProcess = null;
      this.logger.log(`swarm job finished with code ${code}`);
    });

    return this.getSwarmStatus();
  }

  /** وضعیت جاری استخر ایجنت‌ها. */
  getSwarmStatus(): RadarSwarmStatusDto {
    this.recomputeSwarmSummary();
    return {
      ...this.swarmJob,
      agents: this.swarmJob.agents.map((agent) => ({ ...agent })),
      summary: { ...this.swarmJob.summary },
    };
  }

  // ---------------------------------------------------------------- private
  /** پردازش یک خط خروجی حالت stream ازدحام. */
  private consumeSwarmLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.startsWith(SWARM_DONE_PREFIX)) {
      return;
    }
    if (!trimmed.startsWith(SWARM_STREAM_PREFIX)) {
      return;
    }

    let payload: SwarmAgentPayload;
    try {
      payload = JSON.parse(
        trimmed.slice(SWARM_STREAM_PREFIX.length),
      ) as SwarmAgentPayload;
    } catch {
      return;
    }
    if (!payload.agent) {
      return;
    }

    const succeeded = payload.status === 'SUCCESS';
    this.swarmJob.agents = this.swarmJob.agents.map((agent) =>
      agent.id === payload.agent
        ? {
            ...agent,
            status: succeeded ? 'SUCCESS' : 'FAILED',
            elapsedSeconds: payload.time_sec ?? agent.elapsedSeconds ?? null,
            stderr: succeeded ? '' : payload.stderr ?? 'اجرا ناموفق بود.',
          }
        : agent,
    );
    this.recomputeSwarmSummary();
  }

  /** محاسبه مجدد شمارش تجمیعی ایجنت‌ها. */
  private recomputeSwarmSummary(): void {
    const agents = this.swarmJob.agents;
    this.swarmJob.summary = {
      total: agents.length,
      running: agents.filter((a) => a.status === 'RUNNING').length,
      success: agents.filter((a) => a.status === 'SUCCESS').length,
      failed: agents.filter((a) => a.status === 'FAILED').length,
      pending: agents.filter((a) => a.status === 'PENDING').length,
    };
  }

  /** اتصال جریان‌های stdout/stderr به بافر لاگ. */
  private attachLogs(
    child: ChildProcessWithoutNullStreams,
    log: string[],
    prefix: string,
  ): void {
    const handle = (chunk: Buffer): void => {
      for (const line of chunk.toString('utf8').split('\n')) {
        const value = line.trim();
        if (value) {
          this.pushLog(log, `${prefix} ${value}`);
        }
      }
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
  }

  /** افزودن خط به لاگ با حفظ سقف خطوط. */
  private pushLog(log: string[], line: string): void {
    log.push(line);
    if (log.length > MAX_JOB_LOG_LINES) {
      log.splice(0, log.length - MAX_JOB_LOG_LINES);
    }
  }

  /** ساخت محیط اجرای اسکریپت‌های پایتونی. */
  private buildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PYTHONPATH: this.projectRoot,
      ROXIRA_PROJECT_ROOT: this.projectRoot,
      PYTHONUNBUFFERED: '1',
    };
  }

  /** وضعیت ایجنت تازه. */
  private toAgentStatus(
    id: string,
    label: string,
    task: string,
    status: RadarAgentStatusDto['status'],
  ): RadarAgentStatusDto {
    return { id, label, task, status, elapsedSeconds: null, stderr: '' };
  }

  /** کار کاوشگر خالی. */
  private emptyScoutJob(): RadarScoutStatusDto {
    return {
      jobId: null,
      status: 'IDLE',
      topic: null,
      deep: false,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      error: null,
      log: [],
    };
  }

  /** کار ازدحام خالی. */
  private emptySwarmJob(): RadarSwarmStatusDto {
    return {
      jobId: null,
      status: 'IDLE',
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      agents: SWARM_AGENTS.map((agent) =>
        this.toAgentStatus(agent.id, agent.label, agent.task, 'PENDING'),
      ),
      summary: {
        total: SWARM_AGENTS.length,
        running: 0,
        success: 0,
        failed: 0,
        pending: SWARM_AGENTS.length,
      },
    };
  }

  /** استخراج رشته از مقدار نامشخص. */
  private asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  /** استخراج عدد از مقدار نامشخص. */
  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  }

  // ----------------------------------------------------- markdown fallback
  /** استخراج حداقلی داده ساختاریافته از مارک‌داون در نبود JSON. */
  private parseMarkdown(markdown: string): Record<string, unknown> {
    if (!markdown) {
      return {};
    }
    const result: Record<string, unknown> = {};
    const topic = markdown.match(/\*\*موضوع پژوهش:\*\*\s*(.+)/);
    if (topic) result.topic = topic[1].trim();
    const mode = markdown.match(/\*\*حالت اجرا:\*\*\s*`?([^`\n]+)`?/);
    if (mode) result.mode = mode[1].trim();
    const generated = markdown.match(/\*\*زمان تولید \(UTC\):\*\*\s*(.+)/);
    if (generated) result.generated_at = generated[1].trim();
    const sources = markdown.match(/\*\*تعداد منابع تحلیل‌شده:\*\*\s*(\d+)/);
    if (sources) result.source_count = Number(sources[1]);
    const status = markdown.match(/\*\*وضعیت:\*\*\s*`?([^`\n]+)`?/);
    if (status) result.status = status[1].trim();

    const summary = markdown.match(/## خلاصه مدیریتی\n+([\s\S]*?)\n\n/);
    if (summary) result.executive_summary = summary[1].trim();

    result.key_findings = this.extractSection(markdown, 'یافته‌های کلیدی');
    result.risks_and_caveats = this.extractSection(markdown, 'ریسک‌ها و هشدارها');
    result.recommendations = this.extractSection(markdown, 'توصیه‌های راهبردی');
    return result;
  }

  /** استخراج آیتم‌های لیست یک بخش مارک‌داون. */
  private extractSection(markdown: string, heading: string): string[] {
    const match = markdown.match(
      new RegExp(`## ${heading}\\n+([\\s\\S]*?)(\\n## |\\n---|$)`),
    );
    if (!match) {
      return [];
    }
    return match[1]
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);
  }

  /** رندر مارک‌داون سبک از داده ساختاریافته در نبود فایل .md. */
  private renderStructured(structured: Record<string, unknown>): string {
    const lines: string[] = ['# 🛰️ گزارش رادار فناوری ROXIRA', ''];
    const topic = this.asString(structured.topic);
    if (topic) lines.push(`- **موضوع پژوهش:** ${topic}`);
    const summary = this.asString(structured.executive_summary);
    if (summary) {
      lines.push('', '## خلاصه مدیریتی', summary);
    }
    return lines.join('\n');
  }
}
