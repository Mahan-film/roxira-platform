import { Body, Controller, Get, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessRequest, requireAccess } from '../access/access-context';
import { AccessAction, AccessModule } from '../access/catalogue';
import { ModuleAccess, RequireAction } from '../access/decorators';
import { ApprovalRequestStatus } from './constants/approvals.constants';
import {
  ApprovalDelegationView,
  ApprovalRequestView,
  ApprovalRuleView,
  CreateApprovalRequestDto,
  CreateApprovalRuleDto,
  CreateDelegationDto,
  DecideApprovalStepDto,
  RequestGroupBPolicyChangeDto,
} from './dto/approvals.dto';
import { ApprovalsService } from './services/approvals.service';

@ApiTags('Approvals - موتور تأیید چندمرحله‌ای')
@ApiBearerAuth()
@ModuleAccess(AccessModule.MEMBERS)
@Controller('approvals')
export class ApprovalsHttpHandler {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get('rules')
  @ApiOperation({ summary: 'فهرست مراحل و سقف‌های تأیید سازمان' })
  @ApiResponse({ status: HttpStatus.OK })
  listRules(
    @Req() request: AccessRequest,
    @Query('resourceType') resourceType?: string,
  ): Promise<ApprovalRuleView[]> {
    return this.approvals.listRules(requireAccess(request).tenantId, resourceType);
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('rules')
  @ApiOperation({ summary: 'تعریف یا ویرایش مرحله و سقف مبلغ تأیید' })
  @ApiResponse({ status: HttpStatus.CREATED })
  upsertRule(
    @Req() request: AccessRequest,
    @Body() dto: CreateApprovalRuleDto,
  ): Promise<ApprovalRuleView> {
    const ctx = requireAccess(request);
    return this.approvals.upsertRule(
      ctx.tenantId,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      dto,
    );
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('delegations')
  @ApiOperation({ summary: 'ثبت تفویض اختیار زمان‌دار با سقف مبلغ' })
  @ApiResponse({ status: HttpStatus.CREATED })
  createDelegation(
    @Req() request: AccessRequest,
    @Body() dto: CreateDelegationDto,
  ): Promise<ApprovalDelegationView> {
    const ctx = requireAccess(request);
    return this.approvals.createDelegation(
      ctx.tenantId,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      dto,
    );
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('delegations/:id/revoke')
  @ApiOperation({ summary: 'لغو تفویض اختیار' })
  @ApiResponse({ status: HttpStatus.OK })
  revokeDelegation(
    @Req() request: AccessRequest,
    @Param('id') id: string,
  ): Promise<ApprovalDelegationView> {
    const ctx = requireAccess(request);
    return this.approvals.revokeDelegation(
      ctx.tenantId,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      id,
    );
  }

  @Get('requests')
  @ApiOperation({ summary: 'فهرست درخواست‌های تأیید سازمان' })
  @ApiResponse({ status: HttpStatus.OK })
  listRequests(
    @Req() request: AccessRequest,
    @Query('status') status?: ApprovalRequestStatus,
  ): Promise<ApprovalRequestView[]> {
    return this.approvals.listRequests(requireAccess(request).tenantId, status);
  }

  @Get('requests/:id')
  @ApiOperation({ summary: 'جزئیات یک درخواست تأیید و تصمیم‌های مراحل آن' })
  @ApiResponse({ status: HttpStatus.OK })
  getRequest(
    @Req() request: AccessRequest,
    @Param('id') id: string,
  ): Promise<ApprovalRequestView> {
    return this.approvals.getRequest(requireAccess(request).tenantId, id);
  }

  @RequireAction(AccessAction.CREATE)
  @Post('requests')
  @ApiOperation({ summary: 'ثبت درخواست تأیید جدید' })
  @ApiResponse({ status: HttpStatus.CREATED })
  createRequest(
    @Req() request: AccessRequest,
    @Body() dto: CreateApprovalRequestDto,
  ): Promise<ApprovalRequestView> {
    const ctx = requireAccess(request);
    return this.approvals.createRequest(
      ctx.tenantId,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      dto,
    );
  }

  @RequireAction(AccessAction.ADMIN)
  @Post('policy-changes/group-b')
  @ApiOperation({ summary: 'درخواست تغییر قاعدهٔ حفاظتی گروه «ب» (نیازمند تأییدکنندهٔ دوم)' })
  @ApiResponse({ status: HttpStatus.CREATED })
  requestGroupBPolicyChange(
    @Req() request: AccessRequest,
    @Body() dto: RequestGroupBPolicyChangeDto,
  ): Promise<ApprovalRequestView> {
    const ctx = requireAccess(request);
    return this.approvals.requestGroupBPolicyChange(
      ctx.tenantId,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      dto,
    );
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('requests/:id/decide')
  @ApiOperation({ summary: 'تأیید یا رد مرحلهٔ جاری درخواست تأیید' })
  @ApiResponse({ status: HttpStatus.OK })
  decide(
    @Req() request: AccessRequest,
    @Param('id') id: string,
    @Body() dto: DecideApprovalStepDto,
  ): Promise<ApprovalRequestView> {
    const ctx = requireAccess(request);
    return this.approvals.decide(
      ctx.tenantId,
      id,
      { userId: ctx.userId, roleKey: ctx.roleKey },
      dto,
    );
  }
}
