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
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  BankStatementLineResponseDto,
  ConfirmStatementMatchDto,
  ImportBankStatementDto,
  ImportBankStatementResponseDto,
  QueryBankStatementLinesDto,
  StatementMatchResponseDto,
  StatementSettingsResponseDto,
  UpdateStatementSettingsDto,
} from '../dto/bank-statement.dto';
import { BankStatementService } from '../services/bank-statement.service';

@ApiTags('Treasury bank statements - ورود صورتحساب بانکی CAMT.053 / MT940')
@ModuleAccess(AccessModule.BANKING)
@Controller('enterprise-hub/treasury/statements')
export class BankStatementController {
  constructor(private readonly service: BankStatementService) {}

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.CREATE)
  @ApiOperation({ summary: 'ورود فایل صورتحساب بانکی (CAMT.053 یا MT940)؛ ورود دوبارهٔ همان فایل سطر تکراری نمی‌سازد' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ImportBankStatementResponseDto })
  import(@Req() request: AuthenticatedRequest, @Body() dto: ImportBankStatementDto): Promise<ImportBankStatementResponseDto> {
    return this.service.importStatement(requireTenantId(request), this.requireUserId(request), dto);
  }

  @Get('lines')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'فهرست سطرهای صورتحساب بانکی همراه پیشنهاد تطبیق' })
  @ApiResponse({ status: HttpStatus.OK, type: [BankStatementLineResponseDto] })
  lines(@Req() request: AuthenticatedRequest, @Query() query: QueryBankStatementLinesDto): Promise<BankStatementLineResponseDto[]> {
    return this.service.listLines(requireTenantId(request), query);
  }

  @Post('lines/:id/confirm')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'تأیید تطبیق یک واریز با یک یا چند صورتحساب (و کارمزد) و صدور یک سند حسابداری' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StatementMatchResponseDto })
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmStatementMatchDto,
  ): Promise<StatementMatchResponseDto> {
    return this.service.confirmMatch(requireTenantId(request), this.requireUserId(request), id, dto);
  }

  @Get('settings')
  @RequireAction(AccessAction.READ)
  @ApiOperation({ summary: 'تنظیم ثبت خودکار تطبیق‌های دقیق صورتحساب بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementSettingsResponseDto })
  settings(@Req() request: AuthenticatedRequest): Promise<StatementSettingsResponseDto> {
    return this.service.getSettings(requireTenantId(request));
  }

  @Put('settings')
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'روشن/خاموش کردن ثبت خودکار تطبیق‌های دقیق (پیش‌فرض خاموش)' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementSettingsResponseDto })
  updateSettings(@Req() request: AuthenticatedRequest, @Body() dto: UpdateStatementSettingsDto): Promise<StatementSettingsResponseDto> {
    return this.service.setSettings(requireTenantId(request), dto.autoPostExactMatches);
  }

  private requireUserId(request: AuthenticatedRequest): string {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedException('شناسه کاربر در توکن احراز هویت یافت نشد.');
    return userId;
  }
}
