import { Controller, Get, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SystemHealthResponseDto } from '../dto/system-health.dto';
import { SystemHealthService } from '../services/system-health.service';

/**
 * کنترلر پایش سلامت سیستم (System Health Monitoring).
 *
 * مسیر `GET /health/system` به‌صورت VERSION_NEUTRAL ارائه می‌شود تا
 * load balancer و مانیتورینگ بیرونی بدون پیشوند نسخه (`/v1`) به آن
 * دسترسی داشته باشند. فقط مسیریابی HTTP؛ تمام منطق در
 * SystemHealthService است (Rule #2 و Rule #3 — AGENTS.md).
 */
@ApiTags('Health - پایش سلامت سیستم')
@Controller('health')
export class SystemHealthController {
  constructor(private readonly systemHealthService: SystemHealthService) {}

  @Get('system')
  @Version(VERSION_NEUTRAL)
  @ApiOperation({
    summary: 'گزارش سلامت تمام کانتینرها و مصرف حافظه',
    description:
      'وضعیت تمام کانتینرهای Docker، سلامت healthcheck داخلی هر کانتینر، مصرف حافظه کانتینرها و همچنین حافظه و بار میزبان را بازمی‌گرداند.',
  })
  @ApiResponse({ status: 200, type: SystemHealthResponseDto })
  getSystemHealth(): Promise<SystemHealthResponseDto> {
    return this.systemHealthService.getSystemHealth();
  }
}
