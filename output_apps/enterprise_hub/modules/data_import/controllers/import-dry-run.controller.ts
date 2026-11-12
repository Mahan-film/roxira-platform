import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { DATA_IMPORT_RESOURCE } from '../constants/data-import.constants';
import { HolooDryRunDto, SepidarDryRunDto } from '../dto/import-dry-run.dto';
import {
  ImportDryRunReport,
  ImportDryRunService,
} from '../services/import-dry-run.service';

@ApiTags('Data Import - ورود داده از نرم‌افزار دیگر')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ModuleAccess(AccessModule.DATA_IMPORT)
@Controller(DATA_IMPORT_RESOURCE)
export class ImportDryRunController {
  constructor(private readonly dryRunService: ImportDryRunService) {}

  @Post('dry-run/sepidar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'اجرای آزمایشی ورود از سپیدار در تراکنش برگشت‌پذیر و گزارش مغایرت پیش از ثبت',
  })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async dryRunSepidar(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SepidarDryRunDto,
  ): Promise<ImportDryRunReport> {
    return this.dryRunService.dryRunSepidar(requireTenantId(request), dto);
  }

  @Post('dry-run/holoo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'اجرای آزمایشی ورود از هلو در تراکنش برگشت‌پذیر و گزارش مغایرت پیش از ثبت',
  })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'دسترسی غیرمجاز' })
  async dryRunHoloo(
    @Req() request: AuthenticatedRequest,
    @Body() dto: HolooDryRunDto,
  ): Promise<ImportDryRunReport> {
    return this.dryRunService.dryRunHoloo(requireTenantId(request), dto);
  }
}
