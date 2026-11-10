import { Body, Controller, Get, HttpStatus, Param, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessRequest, requireAccess } from '../../access/access-context';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { SetPolicyDto } from './dto/set-policy.dto';
import { PolicyService, PolicyView } from './policy.service';

/**
 * Tenant policy settings. The caller is always the organisation the AccessGuard verified; the tenant
 * id is never read from the request. GET is a read of the members module; PUT needs members:admin, and
 * the service re-checks the actor's role and the group of the key.
 */
@ApiTags('Policies - قواعد سازمان')
@ApiBearerAuth()
@ModuleAccess(AccessModule.MEMBERS)
@Controller('policies')
export class PolicyController {
  constructor(private readonly policies: PolicyService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست قواعد سازمان با مقدار جاری هر قاعده و استثناها' })
  @ApiQuery({
    name: 'exceptions',
    required: false,
    description: 'در صورت ارسال true، فقط استثناها و قواعد تضعیف‌شده گزارش می‌شوند (#584-6)',
    example: 'true',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'گروه‌بندی‌شدهٔ قواعد ثابت، حفاظتی و مدیریتی' })
  list(
    @Req() request: AccessRequest,
    @Query('exceptions') exceptions?: string,
  ): Promise<PolicyView[]> {
    const exceptionsOnly = exceptions === 'true' || exceptions === '1';
    return this.policies.getAll(requireAccess(request).tenantId, { exceptionsOnly });
  }

  @RequireAction(AccessAction.ADMIN)
  @Put(':key')
  @ApiOperation({
    summary: 'تغییر مقدار یک قاعدهٔ سازمانی',
    description: 'قواعد گروه الف ثابت‌اند؛ تغییر گروه ب دلیل طولانی‌تری لازم دارد. تغییر بی‌اثر ثبت نمی‌شود.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'مقدار جدید قاعده' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'قاعده ثابت است یا نقش اجازه نمی‌دهد' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'مقدار یا دلیل نامعتبر است' })
  set(
    @Req() request: AccessRequest,
    @Param('key') key: string,
    @Body() dto: SetPolicyDto,
  ): Promise<PolicyView> {
    const ctx = requireAccess(request);
    return this.policies.set(
      ctx.tenantId,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      key,
      dto.value,
      dto.reason,
      dto.autoRevertAt,
      request,
    );
  }
}
