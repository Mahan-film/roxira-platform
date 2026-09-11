import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RadarController } from './controllers/radar.controller';
import { RadarService } from './services/radar.service';

/**
 * ماژول رادار فناوری و ارکستراسیون ۱۰ ایجنت موازی.
 *
 * این ماژول هیچ وابستگی چرخه‌ای به سایر ماژول‌ها ندارد (Rule #1 — AGENTS.md)
 * و اسکریپت‌های پایتونی موجود در ریشه پروژه را از طریق child_process اجرا
 * می‌کند؛ ریشه پروژه در docker-compose به‌صورت bind mount در دسترس است.
 */
@Module({
  imports: [ConfigModule],
  controllers: [RadarController],
  providers: [RadarService],
  exports: [RadarService],
})
export class RadarModule {}
