import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SystemHealthController } from './controllers/system-health.controller';
import { dockerEngineClientProvider } from './providers/docker-engine.provider';
import { SystemHealthService } from './services/system-health.service';

/**
 * ماژول پایش سلامت سیستم (System Health Monitoring).
 *
 * Layer Boundaries (طبق AGENTS.md):
 * - Controller: فقط مسیریابی HTTP (`GET /health/system`).
 * - Service: گردآوری سلامت کانتینرها، حافظه و بار میزبان.
 * - Provider: کلاینت Docker Engine روی سوکت یونیکس.
 *
 * بدون هیچ import چرخه‌ای با سایر ماژول‌ها (Rule #1 — AGENTS.md).
 */
@Module({
  imports: [ConfigModule],
  controllers: [SystemHealthController],
  providers: [SystemHealthService, dockerEngineClientProvider],
  exports: [SystemHealthService],
})
export class HealthModule {}
