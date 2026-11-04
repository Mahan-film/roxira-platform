import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ConfirmMemoryFactDto, MemoryFactIdDto, RecallMemoryDto } from '../dto/assistant-memory.dto';
import { AssistantMemoryService } from '../memory/assistant-memory.service';

/** حافظهٔ اپیزودیک دستیار: فقط واقعیت‌هایی که کاربر تأیید کرده؛ مستأجر و کاربر فقط از JWT. */
@ApiTags('Assistant - حافظه')
@ApiBearerAuth()
@ModuleAccess(AccessModule.ASSISTANT)
@Controller('enterprise-hub/assistant/memory')
export class AssistantMemoryController {
  constructor(private readonly memory: AssistantMemoryService) {}

  @RequireAction(AccessAction.READ)
  @Post()
  @ApiOperation({ summary: 'ثبت یک واقعیت تأییدشده توسط کاربر' })
  confirm(@Req() request: AuthenticatedRequest, @Body() dto: ConfirmMemoryFactDto) {
    const userId = request.user?.sub;
    if (!userId) throw new ForbiddenException();
    return this.memory.confirm(requireTenantId(request), userId, dto);
  }

  @RequireAction(AccessAction.READ)
  @Get()
  @ApiOperation({ summary: 'بازیابی واقعیت‌های سازمان (در زمان معتبر/زمان دانسته)' })
  recall(@Req() request: AuthenticatedRequest, @Query() dto: RecallMemoryDto) {
    return this.memory.recall(requireTenantId(request), dto);
  }

  @RequireAction(AccessAction.READ)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'فراموش‌کردن یک واقعیت' })
  async forget(@Req() request: AuthenticatedRequest, @Param() params: MemoryFactIdDto): Promise<void> {
    await this.memory.forget(requireTenantId(request), params.id);
  }
}
