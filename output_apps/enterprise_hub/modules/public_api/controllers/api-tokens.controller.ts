import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ApiTokenResponseDto, CreateApiTokenDto, CreatedApiTokenResponseDto } from '../dto/api-token.dto';
import { ApiTokensService } from '../services/api-tokens.service';

/**
 * Token management for tenant admins (signed in with a normal session, `security:admin`).
 * Not part of `/api/v1`: tokens cannot manage tokens.
 */
@ApiTags('Public API - مدیریت توکن')
@ModuleAccess(AccessModule.SECURITY)
@Controller('enterprise-hub/api-tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  @RequireAction(AccessAction.ADMIN)
  @ApiOperation({ summary: 'فهرست توکن‌های API سازمان (بدون خود توکن)' })
  @ApiResponse({ status: HttpStatus.OK, type: [ApiTokenResponseDto] })
  list(@Req() req: AuthenticatedRequest): Promise<ApiTokenResponseDto[]> {
    return this.tokens.list(requireTenantId(req));
  }

  @Post()
  @RequireAction(AccessAction.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ساخت توکن API؛ توکن فقط یک بار در پاسخ نمایش داده می‌شود' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreatedApiTokenResponseDto })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateApiTokenDto): Promise<CreatedApiTokenResponseDto> {
    return this.tokens.create(requireTenantId(req), req.user!.sub, dto);
  }

  @Delete(':id')
  @RequireAction(AccessAction.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ابطال توکن API (فوری و غیرقابل بازگشت)' })
  async revoke(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.tokens.revoke(requireTenantId(req), id);
  }
}
