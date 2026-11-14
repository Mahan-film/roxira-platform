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
  UnauthorizedException,
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
  ParsedBankSmsResponseDto,
  QueryTreasurySmsDraftsDto,
  TreasurySmsDraftResponseDto,
} from '../dto/treasury-sms.dto';
import { TreasuryDocumentDetailResponseDto } from '../dto/treasury.dto';
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
  @ApiResponse({ status: HttpStatus.OK, type: ParsedBankSmsResponseDto })
  parse(@Body() dto: ParseBankSmsDto): ParsedBankSmsResponseDto {
    return this.smsService.previewSms(dto.text);
  }

  @Post('capture')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'پردازش پیامک بانکی و ایجاد پیش‌نویس دریافت/پرداخت خزانه' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TreasurySmsDraftResponseDto })
  async capture(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CaptureBankSmsDto,
  ): Promise<TreasurySmsDraftResponseDto> {
    const tenantId = requireTenantId(request);
    const userId = this.requireUserId(request);
    return this.toDraftResponse(await this.smsService.captureSms(tenantId, userId, dto.text));
  }

  @Get('drafts')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'فهرست پیش‌نویس‌های پیامک بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: [TreasurySmsDraftResponseDto] })
  async listDrafts(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryTreasurySmsDraftsDto,
  ): Promise<TreasurySmsDraftResponseDto[]> {
    const drafts = await this.smsService.listDrafts(requireTenantId(request), query);
    return drafts.map((d) => this.toDraftResponse(d));
  }

  @Get('drafts/:id')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'مشاهده یک پیش‌نویس پیامک بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: TreasurySmsDraftResponseDto })
  async getDraft(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TreasurySmsDraftResponseDto> {
    return this.toDraftResponse(await this.smsService.getDraft(requireTenantId(request), id));
  }

  @Post('drafts/:id/confirm')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'تأیید پیش‌نویس پیامک و صدور سند قطعی دریافت/پرداخت با سند حسابداری خودکار' })
  @ApiResponse({ status: HttpStatus.CREATED, type: TreasuryDocumentDetailResponseDto })
  async confirmDraft(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmTreasurySmsDraftDto,
  ): Promise<TreasuryDocumentDetailResponseDto> {
    const tenantId = requireTenantId(request);
    const userId = this.requireUserId(request);
    return this.smsService.confirmDraft(tenantId, userId, id, dto);
  }

  @Post('drafts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'رد کردن پیش‌نویس پیامک بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: TreasurySmsDraftResponseDto })
  async rejectDraft(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TreasurySmsDraftResponseDto> {
    return this.toDraftResponse(await this.smsService.rejectDraft(requireTenantId(request), id));
  }

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('شناسه کاربر در توکن احراز هویت یافت نشد.');
    }
    return userId;
  }

  private toDraftResponse(draft: TreasurySmsDraftEntity): TreasurySmsDraftResponseDto {
    return {
      id: draft.id,
      bank: draft.bank,
      bankNameFa: draft.bankNameFa,
      direction: draft.direction,
      docKind: draft.docKind,
      amount: draft.amount,
      balance: draft.balance ?? null,
      accountTail: draft.accountTail ?? null,
      cardTail: draft.cardTail ?? null,
      reference: draft.reference ?? null,
      dateTime: draft.dateTime ? draft.dateTime.toISOString() : null,
      rawText: draft.rawText,
      status: draft.status,
      matchedDocumentId: draft.matchedDocumentId ?? null,
      createdAt: draft.createdAt,
    };
  }
}
