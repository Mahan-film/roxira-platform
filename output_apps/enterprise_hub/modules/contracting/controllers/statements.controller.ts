import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateStatementDto, StatementResponseDto } from '../dto/statement.dto';
import { StatementService } from '../services/statement.service';

/** Progress statements (صورت وضعیت): cumulative, numbered, approved, then posted. */
@ApiTags('Contracting - صورت وضعیت')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/contracting')
export class StatementsController {
  constructor(private readonly statements: StatementService) {}

  @Get('contracts/:contractId/statements')
  @ApiOperation({ summary: 'صورت وضعیت‌های یک قرارداد به ترتیب شماره' })
  @ApiResponse({ status: HttpStatus.OK, type: [StatementResponseDto] })
  list(@Req() request: AuthenticatedRequest, @Param('contractId', ParseIntPipe) contractId: number): Promise<StatementResponseDto[]> {
    return this.statements.list(requireTenantId(request), contractId);
  }

  @Post('contracts/:contractId/statements')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'صورت وضعیت جدید با مبلغ تجمعی (شماره خودکار)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StatementResponseDto })
  create(@Req() request: AuthenticatedRequest, @Param('contractId', ParseIntPipe) contractId: number, @Body() dto: CreateStatementDto): Promise<StatementResponseDto> {
    return this.statements.create(requireTenantId(request), contractId, dto);
  }

  @Get('statements/:id')
  @ApiOperation({ summary: 'یک صورت وضعیت' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementResponseDto })
  getById(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<StatementResponseDto> {
    return this.statements.getById(requireTenantId(request), id);
  }

  @Post('statements/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireAction(AccessAction.APPROVE)
  @ApiOperation({ summary: 'تأیید صورت وضعیت' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementResponseDto })
  approve(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<StatementResponseDto> {
    return this.statements.approve(requireTenantId(request), id);
  }

  @Post('statements/:id/post')
  @HttpCode(HttpStatus.OK)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'ثبت سند حسابداری صورت وضعیت تأییدشده (تکرار امن)' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementResponseDto })
  post(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<StatementResponseDto> {
    return this.statements.post(requireTenantId(request), id);
  }

  @Delete('statements/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف صورت وضعیت پیش‌نویس' })
  remove(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.statements.remove(requireTenantId(request), id);
  }
}
