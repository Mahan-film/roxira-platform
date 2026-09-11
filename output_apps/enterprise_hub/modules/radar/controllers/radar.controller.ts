import {
  Body,
  Controller,
  Get,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  RadarReportResponseDto,
  RadarScoutStatusDto,
  RadarSwarmStatusDto,
  RunSwarmDto,
  TriggerScoutDto,
} from '../dto/radar.dto';
import { RadarService } from '../services/radar.service';

/**
 * کنترلر پنل متمرکز فرماندهی رادار فناوری.
 *
 * مسیر `enterprise-hub/radar` هم نسخه‌دار (`/v1/...` برای پروکسی فرانت‌اند)
 * و هم نسخه‌خنثی (بدون پیشوند، مطابق قرارداد عملیاتی) ثبت شده است. تمام
 * منطق در RadarService است و کنترلر فقط مسیریابی HTTP انجام می‌دهد
 * (Rule #2 و Rule #3 — AGENTS.md).
 */
@ApiTags('Radar - رادار فناوری و ازدحام ایجنت‌ها')
@Controller({ path: 'enterprise-hub/radar', version: ['1', VERSION_NEUTRAL] })
export class RadarController {
  constructor(private readonly radarService: RadarService) {}

  @Get('report')
  @ApiOperation({
    summary: 'خواندن گزارش رسمی رادار فناوری',
    description:
      'محتوای TECH_RADAR_REPORT.md و داده ساختاریافته TECH_RADAR_REPORT.json را بازمی‌گرداند.',
  })
  @ApiOkResponse({ type: RadarReportResponseDto })
  getReport(): Promise<RadarReportResponseDto> {
    return this.radarService.getReport();
  }

  @Post('trigger-scout')
  @ApiOperation({
    summary: 'اجرای زنده کاوشگر فناوری با موضوع دلخواه',
    description:
      'اسکریپت src/automation/tech_radar.py را در پس‌زمینه با موضوع کاربر اجرا می‌کند و وضعیت کار را بازمی‌گرداند.',
  })
  @ApiBody({ type: TriggerScoutDto })
  @ApiResponse({ status: 201, type: RadarScoutStatusDto })
  triggerScout(@Body() dto: TriggerScoutDto): RadarScoutStatusDto {
    return this.radarService.triggerScout(dto);
  }

  @Get('scout-status')
  @ApiOperation({ summary: 'وضعیت زنده آخرین اجرای کاوشگر فناوری' })
  @ApiOkResponse({ type: RadarScoutStatusDto })
  getScoutStatus(): RadarScoutStatusDto {
    return this.radarService.getScoutStatus();
  }

  @Post('run-swarm')
  @ApiOperation({
    summary: 'اجرای موازی استخر ۱۰ ایجنت و بازگرداندن وضعیت زنده',
    description:
      'اسکریپت src/automation/parallel_swarm_runner.py را با حالت stream اجرا کرده و وضعیت ۱۰ ایجنت را لحظه‌ای بازمی‌گرداند.',
  })
  @ApiBody({ type: RunSwarmDto })
  @ApiResponse({ status: 201, type: RadarSwarmStatusDto })
  runSwarm(@Body() dto: RunSwarmDto): RadarSwarmStatusDto {
    return this.radarService.runSwarm(dto);
  }

  @Get('swarm-status')
  @ApiOperation({ summary: 'وضعیت زنده استخر ۱۰ ایجنت موازی' })
  @ApiOkResponse({ type: RadarSwarmStatusDto })
  getSwarmStatus(): RadarSwarmStatusDto {
    return this.radarService.getSwarmStatus();
  }
}
