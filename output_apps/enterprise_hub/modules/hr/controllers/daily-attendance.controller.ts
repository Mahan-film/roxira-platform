import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  AttendanceEventResponseDto,
  CreateAttendanceEventDto,
  DailyAttendanceSummaryDto,
  ImportAttendanceCsvDto,
  ImportAttendanceResultDto,
  QueryDailyAttendanceDto,
  RollupAttendanceDto,
  RollupAttendanceResultDto,
} from '../dto/attendance-event.dto';
import { DailyAttendanceService } from '../services/daily-attendance.service';

@ApiTags('Daily Attendance')
@ModuleAccess(AccessModule.HR)
@Controller('enterprise-hub/hr/attendance')
export class DailyAttendanceController {
  constructor(private readonly dailyAttendanceService: DailyAttendanceService) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  @RequireAction(AccessAction.CREATE)
  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت تردد ورود یا خروج پرسنل (Clock In / Out)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AttendanceEventResponseDto })
  async recordEvent(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAttendanceEventDto,
  ): Promise<AttendanceEventResponseDto> {
    const createdBy = request.user?.sub ?? request.user?.phone ?? null;
    return this.dailyAttendanceService.recordEvent(this.tenantIdOf(request), dto, createdBy ?? undefined);
  }

  @RequireAction(AccessAction.READ)
  @Get('daily')
  @ApiOperation({ summary: 'گزارش تردد روزانه به تفکیک شعبه (حاضر، غایب، تأخیر و مرخصی)' })
  @ApiResponse({ status: HttpStatus.OK, type: DailyAttendanceSummaryDto })
  async getDailySummary(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryDailyAttendanceDto,
  ): Promise<DailyAttendanceSummaryDto> {
    return this.dailyAttendanceService.getDailySummary(
      this.tenantIdOf(request),
      query.date,
      query.branchId,
    );
  }

  @RequireAction(AccessAction.CREATE)
  @Post('import-csv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بارگذاری لاگ دستگاه حضور و غیاب (ZKTeco / CSV)' })
  @ApiResponse({ status: HttpStatus.OK, type: ImportAttendanceResultDto })
  async importCsv(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ImportAttendanceCsvDto,
  ): Promise<ImportAttendanceResultDto> {
    const createdBy = request.user?.sub ?? request.user?.phone ?? null;
    return this.dailyAttendanceService.importCsv(
      this.tenantIdOf(request),
      dto.csvData,
      dto.branchId,
      createdBy ?? undefined,
    );
  }

  @RequireAction(AccessAction.CREATE)
  @Post('rollup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'محاسبه کارکرد ماهانه برای حقوق و دستمزد (Rollup to hr_attendances)' })
  @ApiResponse({ status: HttpStatus.OK, type: RollupAttendanceResultDto })
  async rollupMonthly(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RollupAttendanceDto,
  ): Promise<RollupAttendanceResultDto> {
    return this.dailyAttendanceService.rollupMonthly(
      this.tenantIdOf(request),
      dto.periodYear,
      dto.periodMonth,
      dto.employeeId,
    );
  }
}
