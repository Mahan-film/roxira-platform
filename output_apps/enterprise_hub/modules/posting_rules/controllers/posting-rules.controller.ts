import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ALL_DOC_TYPES } from '../constants/posting-roles';
import { PostingTemplateResponseDto, SetRoleAccountDto } from '../dto/posting-rules.dto';
import { PostingRulesService } from '../services/posting-rules.service';

/** URL alias for the tenant-wide mapping ("*" is awkward in a path). */
const ALL_ALIAS = 'all';
const docTypeOf = (param: string) => (param === ALL_ALIAS ? ALL_DOC_TYPES : param);

/**
 * Settings of the posting rules engine: which account each role uses per document type. Reading
 * needs accounting read, changing a mapping needs accounting admin. The tenant comes only from the
 * verified JWT claim.
 */
@ApiTags('Posting rules - تنظیمات ثبت خودکار سند')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/posting-rules')
export class PostingRulesController {
  constructor(private readonly service: PostingRulesService) {}

  @Get()
  @ApiOperation({ summary: 'قالب‌های ثبت خودکار و حساب هر نقش' })
  @ApiResponse({ status: HttpStatus.OK, type: [PostingTemplateResponseDto] })
  list(@Req() request: AuthenticatedRequest): Promise<PostingTemplateResponseDto[]> {
    return this.service.describe(requireTenantId(request));
  }

  @Put(':docType/roles/:role')
  @RequireAction(AccessAction.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'تعیین حساب یک نقش (docType=all برای همه‌ی اسناد)' })
  async set(@Req() request: AuthenticatedRequest, @Param('docType') docType: string, @Param('role') role: string, @Body() dto: SetRoleAccountDto): Promise<void> {
    await this.service.setMapping(requireTenantId(request), docTypeOf(docType), role, dto.accountCode);
  }

  @Delete(':docType/roles/:role')
  @RequireAction(AccessAction.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'بازگشت یک نقش به حساب پیش‌فرض' })
  async clear(@Req() request: AuthenticatedRequest, @Param('docType') docType: string, @Param('role') role: string): Promise<void> {
    await this.service.clearMapping(requireTenantId(request), docTypeOf(docType), role);
  }
}
