import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Get,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { AssistantChatDto } from '../dto/assistant-chat.dto';
import { AssistantChatResponseDto } from '../dto/assistant-response.dto';
import { AssistantService } from '../services/assistant.service';

/**
 * کنترلر دستیار هوشمند روی داده‌های خود سازمان.
 * فقط مسیریابی و اعتبارسنجی DTO؛ مستأجر «تنها» از JWT (Rule #4 - AGENTS.md).
 */
@ApiTags('Assistant - دستیار هوشمند سازمان')
@ApiBearerAuth()
@ModuleAccess(AccessModule.ASSISTANT)
@Controller('enterprise-hub/assistant')
export class AssistantController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly config: ConfigService,
  ) {}

  /** دستیار فقط وقتی `ASSISTANT_ENABLED` روشن باشد کار می‌کند (پیش‌فرض: خاموش). */
  private isEnabled(): boolean {
    const raw = String(this.config.get<string>('ASSISTANT_ENABLED', '') ?? '');
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  @Get('status')
  @ApiOperation({ summary: 'آیا دستیار هوشمند فعال است؟' })
  @ApiResponse({ status: HttpStatus.OK, description: '{ enabled: boolean }' })
  status(@Req() request: AuthenticatedRequest): { enabled: boolean } {
    requireTenantId(request);
    return { enabled: this.isEnabled() };
  }

  @RequireAction(AccessAction.READ)
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'پرسش از دستیار درباره داده‌های سازمان',
    description:
      'پاسخ فارسی همراه با فهرست ابزارهای فقط‌خواندنی که برای پاسخ فراخوانی شدند.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AssistantChatResponseDto })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'کاربر بدون سازمان' })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'سقف پرسش سازمان پر شده است',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'هیچ مدلی در دسترس نیست',
  })
  async chat(
    @Req() request: AuthenticatedRequest,
    @Body() dto: AssistantChatDto,
  ): Promise<AssistantChatResponseDto> {
    requireTenantId(request);
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'دستیار هوشمند در حال حاضر فعال نیست.',
      );
    }
    return this.assistantService.chat(request, dto);
  }
}
