import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import {
  DOCKER_ENGINE_CLIENT,
  MEMINFO_PATH,
} from '../constants/health.constants';
import {
  ContainerHealthDto,
  ContainerHealthState,
  ContainerSummaryDto,
  SystemHealthResponseDto,
  SystemMemoryDto,
} from '../dto/system-health.dto';
import {
  DockerContainerStats,
  DockerContainerSummary,
  DockerEngineClient,
} from '../providers/docker-engine.client';

/**
 * سرویس پایش سلامت سیستم (System Health Service).
 *
 * سلامت تمام کانتینرهای Docker و مصرف حافظه (کانتینر و میزبان) را از طریق
 * Docker Engine API روی سوکت یونیکس گردآوری می‌کند. در صورت عدم دسترسی به
 * سوکت، وضعیت `degraded` با پرچم `dockerAvailable=false` بازگردانده می‌شود
 * تا خود سرویس همچنان پاسخگو بماند (Rule #3 — AGENTS.md).
 */
@Injectable()
export class SystemHealthService {
  constructor(
    @Inject(DOCKER_ENGINE_CLIENT)
    private readonly docker: DockerEngineClient,
  ) {}

  /** گردآوری کامل گزارش سلامت سیستم. */
  async getSystemHealth(): Promise<SystemHealthResponseDto> {
    const timestamp = new Date().toISOString();
    const base = {
      timestamp,
      hostname: os.hostname(),
      uptimeSeconds: Math.floor(os.uptime()),
      loadAverage: os.loadavg().map((value) => this.round(value, 2)),
      systemMemory: this.readSystemMemory(),
    };

    try {
      const summaries = await this.docker.request<DockerContainerSummary[]>(
        '/containers/json?all=true',
      );
      const containers = await Promise.all(
        summaries.map((summary) => this.toContainerHealth(summary)),
      );
      const summary = this.summarize(containers);

      return {
        status: this.resolveOverallStatus(containers),
        ...base,
        dockerAvailable: true,
        summary,
        containers,
      };
    } catch (error) {
      return {
        status: 'degraded',
        ...base,
        dockerAvailable: false,
        dockerError:
          error instanceof Error ? error.message : 'خطای نامشخص Docker Engine',
        summary: { total: 0, running: 0, healthy: 0, unhealthy: 0, stopped: 0 },
        containers: [],
      };
    }
  }

  /** تبدیل خلاصه کانتینر به گزارش سلامت همراه با آمار مصرف. */
  private async toContainerHealth(
    summary: DockerContainerSummary,
  ): Promise<ContainerHealthDto> {
    const name = (summary.Names?.[0] ?? summary.Id).replace(/^\//, '');
    const base: ContainerHealthDto = {
      id: summary.Id.slice(0, 12),
      name,
      image: summary.Image,
      state: summary.State,
      status: summary.Status,
      health: this.parseHealth(summary.State, summary.Status),
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      memoryUsagePercent: null,
      cpuPercent: null,
    };

    if (summary.State !== 'running') {
      return base;
    }

    try {
      const stats = await this.docker.request<DockerContainerStats>(
        `/containers/${summary.Id}/stats?stream=false`,
      );
      return {
        ...base,
        ...this.readMemoryStats(stats),
        cpuPercent: this.readCpuPercent(stats),
      };
    } catch {
      return base;
    }
  }

  /** استخراج وضعیت healthcheck از رشته Status داكر. */
  private parseHealth(
    state: string,
    status: string,
  ): ContainerHealthState {
    if (state !== 'running') {
      return 'none';
    }
    const match = status.match(/\((healthy|unhealthy|starting)\)/);
    return match ? (match[1] as ContainerHealthState) : 'none';
  }

  /** محاسبه مصرف حافظه مؤثر کانتینر (کسر cache/inactive_file). */
  private readMemoryStats(
    stats: DockerContainerStats,
  ): Pick<
    ContainerHealthDto,
    'memoryUsageBytes' | 'memoryLimitBytes' | 'memoryUsagePercent'
  > {
    const rawUsage = stats.memory_stats?.usage ?? 0;
    const cache =
      stats.memory_stats?.stats?.inactive_file ??
      stats.memory_stats?.stats?.cache ??
      0;
    const usage = Math.max(rawUsage - cache, 0);
    const limit = stats.memory_stats?.limit ?? 0;

    return {
      memoryUsageBytes: usage,
      memoryLimitBytes: limit > 0 ? limit : null,
      memoryUsagePercent: limit > 0 ? this.round((usage / limit) * 100, 2) : null,
    };
  }

  /** محاسبه درصد مصرف CPU کانتینر از دلتای آمار. */
  private readCpuPercent(stats: DockerContainerStats): number | null {
    const cpu = stats.cpu_stats;
    const pre = stats.precpu_stats;
    const cpuDelta =
      (cpu?.cpu_usage?.total_usage ?? 0) - (pre?.cpu_usage?.total_usage ?? 0);
    const systemDelta =
      (cpu?.system_cpu_usage ?? 0) - (pre?.system_cpu_usage ?? 0);
    const onlineCpus =
      cpu?.online_cpus || cpu?.cpu_usage?.percpu_usage?.length || 1;

    if (cpuDelta <= 0 || systemDelta <= 0) {
      return null;
    }
    return this.round((cpuDelta / systemDelta) * onlineCpus * 100, 2);
  }

  /** خواندن حافظه میزبان از /proc/meminfo با fallback به os. */
  private readSystemMemory(): SystemMemoryDto {
    try {
      const meminfo = fs.readFileSync(MEMINFO_PATH, 'utf8');
      const totalKb = this.readMeminfoValue(meminfo, 'MemTotal');
      const availableKb = this.readMeminfoValue(meminfo, 'MemAvailable');
      if (totalKb > 0 && availableKb >= 0) {
        const totalBytes = totalKb * 1024;
        const availableBytes = availableKb * 1024;
        const usedBytes = Math.max(totalBytes - availableBytes, 0);
        return {
          totalBytes,
          availableBytes,
          usedBytes,
          usedPercent: this.round((usedBytes / totalBytes) * 100, 2),
        };
      }
    } catch {
      // در نبود /proc/meminfo به مقادیر os تکیه می‌کنیم.
    }

    const totalBytes = os.totalmem();
    const availableBytes = os.freemem();
    const usedBytes = Math.max(totalBytes - availableBytes, 0);
    return {
      totalBytes,
      availableBytes,
      usedBytes,
      usedPercent:
        totalBytes > 0 ? this.round((usedBytes / totalBytes) * 100, 2) : 0,
    };
  }

  /** استخراج مقدار یک کلید از محتوای /proc/meminfo (به کیلوبایت). */
  private readMeminfoValue(meminfo: string, key: string): number {
    const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm'));
    return match ? Number(match[1]) : -1;
  }

  /** شمارش تجمیعی وضعیت کانتینرها. */
  private summarize(containers: ContainerHealthDto[]): ContainerSummaryDto {
    return {
      total: containers.length,
      running: containers.filter((c) => c.state === 'running').length,
      healthy: containers.filter((c) => c.health === 'healthy').length,
      unhealthy: containers.filter((c) => c.health === 'unhealthy').length,
      stopped: containers.filter((c) => c.state !== 'running').length,
    };
  }

  /** تعیین وضعیت کلی سیستم بر مبنای نتایج پایش. */
  private resolveOverallStatus(
    containers: ContainerHealthDto[],
  ): SystemHealthResponseDto['status'] {
    const hasProblem = containers.some(
      (c) =>
        c.state !== 'running' ||
        c.health === 'unhealthy' ||
        c.health === 'starting',
    );
    return hasProblem ? 'degraded' : 'ok';
  }

  /** گردکردن عدد تا تعداد ارقام اعشار مشخص. */
  private round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}
