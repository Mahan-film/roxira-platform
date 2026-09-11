import { ApiProperty } from '@nestjs/swagger';

/** وضعیت کلی سیستم. */
export type SystemHealthStatus = 'ok' | 'degraded' | 'error';

/** وضعیت سلامت یک کانتینر بر مبنای healthcheck داخلی آن. */
export type ContainerHealthState =
  | 'healthy'
  | 'unhealthy'
  | 'starting'
  | 'none';

/** فراداده و مصرف حافظه یک کانتینر. */
export class ContainerHealthDto {
  @ApiProperty({ example: 'a1b2c3d4e5f6', description: 'شناسه کوتاه کانتینر' })
  id: string;

  @ApiProperty({ example: 'roxira_postgres_prod' })
  name: string;

  @ApiProperty({ example: 'postgres:17-alpine' })
  image: string;

  @ApiProperty({ example: 'running', description: 'running | exited | ...' })
  state: string;

  @ApiProperty({ example: 'Up 3 hours (healthy)' })
  status: string;

  @ApiProperty({
    enum: ['healthy', 'unhealthy', 'starting', 'none'],
    example: 'healthy',
  })
  health: ContainerHealthState;

  @ApiProperty({
    example: 62349312,
    nullable: true,
    description: 'مصرف حافظه کانتینر (بایت)',
  })
  memoryUsageBytes: number | null;

  @ApiProperty({
    example: 1595088896,
    nullable: true,
    description: 'سقف حافظه کانتینر (بایت)',
  })
  memoryLimitBytes: number | null;

  @ApiProperty({
    example: 3.91,
    nullable: true,
    description: 'درصد مصرف حافظه نسبت به سقف',
  })
  memoryUsagePercent: number | null;

  @ApiProperty({
    example: 0.42,
    nullable: true,
    description: 'درصد مصرف CPU',
  })
  cpuPercent: number | null;
}

/** وضعیت حافظه میزبان. */
export class SystemMemoryDto {
  @ApiProperty({ example: 15950888960, description: 'کل حافظه (بایت)' })
  totalBytes: number;

  @ApiProperty({ example: 13466560, description: 'حافظه در دسترس (بایت)' })
  availableBytes: number;

  @ApiProperty({ example: 2484288000, description: 'حافظه مصرف‌شده (بایت)' })
  usedBytes: number;

  @ApiProperty({ example: 15.58, description: 'درصد مصرف حافظه' })
  usedPercent: number;
}

/** شمارش وضعیت کانتینرها. */
export class ContainerSummaryDto {
  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 7 })
  running: number;

  @ApiProperty({ example: 5 })
  healthy: number;

  @ApiProperty({ example: 0 })
  unhealthy: number;

  @ApiProperty({ example: 1 })
  stopped: number;
}

/** پاسخ کامل پایش سلامت سیستم. */
export class SystemHealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'], example: 'ok' })
  status: SystemHealthStatus;

  @ApiProperty({ example: '2026-09-11T14:16:20.000Z' })
  timestamp: string;

  @ApiProperty({ example: 'roxira-app-01' })
  hostname: string;

  @ApiProperty({ example: 172800, description: 'زمان فعالیت میزبان (ثانیه)' })
  uptimeSeconds: number;

  @ApiProperty({
    type: [Number],
    example: [0.12, 0.08, 0.05],
    description: 'میانگین بار ۱/۵/۱۵ دقیقه',
  })
  loadAverage: number[];

  @ApiProperty({ type: SystemMemoryDto })
  systemMemory: SystemMemoryDto;

  @ApiProperty({ example: true, description: 'آیا Docker Engine در دسترس است؟' })
  dockerAvailable: boolean;

  @ApiProperty({
    required: false,
    example: null,
    description: 'خطای دسترسی به Docker Engine (در صورت وجود)',
  })
  dockerError?: string;

  @ApiProperty({ type: ContainerSummaryDto })
  summary: ContainerSummaryDto;

  @ApiProperty({ type: [ContainerHealthDto] })
  containers: ContainerHealthDto[];
}
