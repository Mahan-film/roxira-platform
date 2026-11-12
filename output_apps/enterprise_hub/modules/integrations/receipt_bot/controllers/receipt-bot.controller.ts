import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../../access/decorators';
import { AuthenticatedRequest } from '../../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../../tenants/tenant-context';
import {
  GenerateLinkCodeResponseDto,
  ReceiptBotStatusResponseDto,
  UpdateReceiptBotPreferencesDto,
} from '../dto/receipt-bot.dto';
import { ReceiptBotService } from '../services/receipt-bot.service';

@ApiTags('Integrations - بات دریافت رسید تلگرام')
@ApiBearerAuth()
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/integrations/receipt-bot')
export class ReceiptBotController {
  constructor(private readonly service: ReceiptBotService) {}

  private userContext(request: AuthenticatedRequest): { tenantId: string; userId: string } {
    const tenantId = requireTenantId(request);
    const userId = request.user?.sub;
    if (!userId) {
      throw new ForbiddenException('شناسه کاربر در توکن احراز هویت یافت نشد.');
    }
    return {
      tenantId,
      userId,
    };
  }

  @RequireAction(AccessAction.POST)
  @Post('link-code')
  @ApiOperation({ summary: 'ایجاد کد یکبار مصرف ۶ رقمی برای اتصال بات به حساب کاربر' })
  @ApiResponse({ status: HttpStatus.OK, type: GenerateLinkCodeResponseDto })
  async generateCode(@Req() request: AuthenticatedRequest): Promise<GenerateLinkCodeResponseDto> {
    const { tenantId, userId } = this.userContext(request);
    return this.service.generateLinkCode(tenantId, userId);
  }

  @RequireAction(AccessAction.READ)
  @Get('status')
  @ApiOperation({ summary: 'بررسی وضعیت اتصال بات پیام‌رسان و تنظیمات آن' })
  @ApiResponse({ status: HttpStatus.OK, type: ReceiptBotStatusResponseDto })
  async getStatus(@Req() request: AuthenticatedRequest): Promise<ReceiptBotStatusResponseDto> {
    const { tenantId, userId } = this.userContext(request);
    return this.service.getStatus(tenantId, userId);
  }

  @RequireAction(AccessAction.POST)
  @Delete('link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'قطع اتصال ربات پیام‌رسان از حساب کاربری' })
  async unlink(@Req() request: AuthenticatedRequest): Promise<void> {
    const { tenantId, userId } = this.userContext(request);
    await this.service.unlink(tenantId, userId);
  }

  @RequireAction(AccessAction.POST)
  @Put('preferences')
  @ApiOperation({ summary: 'تغییر نوع پیش‌فرض پیش‌نویس (تنخواه‌گردان یا خرید)' })
  @ApiResponse({ status: HttpStatus.OK, type: ReceiptBotStatusResponseDto })
  async updatePreferences(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateReceiptBotPreferencesDto,
  ): Promise<ReceiptBotStatusResponseDto> {
    const { tenantId, userId } = this.userContext(request);
    return this.service.updatePreferences(tenantId, userId, dto);
  }
}
