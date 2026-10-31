import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  MoadianCredentialResponseDto,
  MoadianSubmissionResponseDto,
} from '../dto/moadian-response.dto';
import { PutMoadianCredentialDto } from '../dto/put-moadian-credential.dto';
import { MoadianService } from '../services/moadian.service';

/**
 * اتصال زنده به سامانه مودیان (پشت پرچم MOADIAN_ENABLED).
 * شناسه مستأجر فقط از claim تأییدشده JWT خوانده می‌شود (Rule #4 - AGENTS.md).
 */
@ApiTags('Tax Compliance - اتصال زنده سامانه مودیان')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/moadian')
export class MoadianController {
  constructor(private readonly moadianService: MoadianService) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    return requireTenantId(request);
  }

  @RequireAction(AccessAction.ADMIN)
  @Put('credentials')
  @ApiOperation({
    summary: 'ثبت/جایگزینی شناسه حافظه، گواهی و کلید خصوصی مودیان',
    description: 'کلید خصوصی رمزشده ذخیره می‌شود و هرگز بازگردانده نمی‌شود.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianCredentialResponseDto })
  async putCredential(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PutMoadianCredentialDto,
  ): Promise<MoadianCredentialResponseDto> {
    return this.moadianService.putCredential(this.tenantIdOf(request), dto);
  }

  @Get('credentials')
  @ApiOperation({ summary: 'اطلاعات عمومی اتصال مودیان سازمان' })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianCredentialResponseDto })
  async getCredential(@Req() request: AuthenticatedRequest): Promise<MoadianCredentialResponseDto> {
    return this.moadianService.getCredential(this.tenantIdOf(request));
  }

  @RequireAction(AccessAction.POST)
  @Post('invoices/:invoiceId/submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'ارسال صورتحساب به سامانه مودیان (صف BullMQ)' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: MoadianSubmissionResponseDto })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<MoadianSubmissionResponseDto> {
    return this.moadianService.submitInvoice(this.tenantIdOf(request), invoiceId);
  }

  @Get('invoices/:invoiceId/status')
  @ApiOperation({ summary: 'وضعیت ارسال صورتحساب به سامانه مودیان' })
  @ApiResponse({ status: HttpStatus.OK, type: MoadianSubmissionResponseDto })
  async status(
    @Req() request: AuthenticatedRequest,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<MoadianSubmissionResponseDto> {
    return this.moadianService.getSubmission(this.tenantIdOf(request), invoiceId);
  }
}
