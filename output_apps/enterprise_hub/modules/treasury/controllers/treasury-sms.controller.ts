import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { TreasurySmsService } from '../services/treasury-sms.service';
import {
  CaptureBankSmsDto,
  ConfirmTreasurySmsDraftDto,
  ParseBankSmsDto,
  QueryTreasurySmsDraftsDto,
  TreasurySmsDraftResponseDto,
} from '../dto/treasury-sms.dto';
import { TreasuryDocumentDetailResponseDto } from '../dto/treasury.dto';
import { BankSmsParsedResult } from '../sms/bank-sms.types';
import { TreasurySmsDraftEntity } from '../entities/treasury-sms-draft.entity';

@ApiTags('Treasury SMS - دریافت و پرداخت از پیامک بانک')
@ModuleAccess(AccessModule.BANKING)
@Controller('enterprise-hub/treasury/sms')
export class TreasurySmsController {
  constructor(private readonly smsService: TreasurySmsService) {}

  @Post('parse')
  @HttpCode(HttpStatus.OK)
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'پردازش و استخراج اطلاعات پیامک بانکی بدون ذخیره‌سازی' })
  @ApiResponse({ status: HttpStatus.OK, description: 'نتیجه پردازش پیامک' })
  parse(@Body() dto: ParseBankSmsDto): BankSmsParsedResult {
    return this.smsService.parseSms(dto.text);
  }

  @Post('capture')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'پردازش پیامک بانکی و ایجاد پیش‌نویس دریافت/پرداخت خزانه' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TreasurySmsDraftResponseDto })
  capture(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CaptureBankSmsDto,
  ): Promise<TreasurySmsDraftEntity> {
    const tenantId = requireTenantId(request);
    const userId = request.user?.sub ?? '00000000-0000-0000-0000-000000000000';
    return this.smsService.captureSms(tenantId, userId, dto.text);
  }

  @Get('drafts')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'فهرست پیش‌نویس‌های پیامک بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: [TreasurySmsDraftResponseDto] })
  listDrafts(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryTreasurySmsDraftsDto,
  ): Promise<TreasurySmsDraftEntity[]> {
    return this.smsService.listDrafts(requireTenantId(request), query);
  }

  @Get('drafts/:id')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'مشاهده یک پیش‌نویس پیامک بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: TreasurySmsDraftResponseDto })
  getDraft(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TreasurySmsDraftEntity> {
    return this.smsService.getDraft(requireTenantId(request), id);
  }

  @Post('drafts/:id/confirm')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'تأیید پیش‌نویس پیامک و صدور سند قطعی دریافت/پرداخت با سند حسابداری خودکار' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TreasuryDocumentDetailResponseDto })
  confirmDraft(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmTreasurySmsDraftDto,
  ): Promise<TreasuryDocumentDetailResponseDto> {
    const tenantId = requireTenantId(request);
    const userId = request.user?.sub ?? '00000000-0000-0000-0000-000000000000';
    return this.smsService.confirmDraft(tenantId, userId, id, dto);
  }

  @Post('drafts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'رد کردن پیش‌نویس پیامک بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: TreasurySmsDraftResponseDto })
  rejectDraft(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TreasurySmsDraftEntity> {
    return this.smsService.rejectDraft(requireTenantId(request), id);
  }
}
