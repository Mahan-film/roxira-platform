import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import {
  requireTenantAdmin,
  requireTenantId,
} from '../../tenants/tenant-context';
import {
  BankAccountResponseDto,
  CreateBankAccountDto,
} from '../dto/bank-account.dto';
import {
  AutoMatchDto,
  AutoMatchResponseDto,
  BookLineResponseDto,
  CreateEntryFromLineDto,
  ManualMatchDto,
  QueryBookLinesDto,
  QueryStatementLinesDto,
  ReconciliationSummaryDto,
  StatementLineResponseDto,
  SummaryQueryDto,
} from '../dto/reconciliation.dto';
import { BankingService } from '../services/banking.service';

/**
 * کنترلر حساب‌های بانکی و مغایرت‌گیری بانکی.
 *
 * فقط مسیریابی و اعتبارسنجی؛ شناسه مستأجر تنها از claim تأییدشده JWT خوانده
 * می‌شود (`requireTenantId`) و دسترسی مدیریتی با `requireTenantAdmin` بررسی
 * می‌شود (AGENTS.md §4). ورود سطرهای صورتحساب از مسیر عمومی ورود داده با
 * موجودیت `bank-statement` انجام می‌شود.
 */
@ApiTags('Banking - حساب بانکی و مغایرت‌گیری')
@Controller('enterprise-hub/banking')
export class BankingController {
  constructor(private readonly bankingService: BankingService) {}

  private tenantIdOf(request: AuthenticatedRequest): string {
    requireTenantAdmin(request);
    return requireTenantId(request);
  }

  @Get('accounts')
  @ApiOperation({ summary: 'فهرست حساب‌های بانکی' })
  @ApiResponse({ status: HttpStatus.OK, type: [BankAccountResponseDto] })
  async listAccounts(
    @Req() request: AuthenticatedRequest,
  ): Promise<BankAccountResponseDto[]> {
    return this.bankingService.listAccounts(this.tenantIdOf(request));
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف حساب بانکی متصل به حساب دفتر کل' })
  @ApiResponse({ status: HttpStatus.CREATED, type: BankAccountResponseDto })
  async createAccount(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    return this.bankingService.createAccount(this.tenantIdOf(request), dto);
  }

  @Get('accounts/:id/statement-lines')
  @ApiOperation({ summary: 'سطرهای صورتحساب بانک' })
  @ApiResponse({ status: HttpStatus.OK, type: [StatementLineResponseDto] })
  async listStatementLines(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryStatementLinesDto,
  ): Promise<StatementLineResponseDto[]> {
    return this.bankingService.listStatementLines(this.tenantIdOf(request), id, query);
  }

  @Get('accounts/:id/book-lines')
  @ApiOperation({ summary: 'سطرهای دفتر حساب بانک (برای تطبیق دستی)' })
  @ApiResponse({ status: HttpStatus.OK, type: [BookLineResponseDto] })
  async listBookLines(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryBookLinesDto,
  ): Promise<BookLineResponseDto[]> {
    return this.bankingService.listBookLines(this.tenantIdOf(request), id, query);
  }

  @Post('accounts/:id/auto-match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تطبیق خودکار (مبلغ + پنجره تاریخ + شماره پیگیری)' })
  @ApiResponse({ status: HttpStatus.OK, type: AutoMatchResponseDto })
  async autoMatch(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AutoMatchDto,
  ): Promise<AutoMatchResponseDto> {
    return this.bankingService.autoMatch(this.tenantIdOf(request), id, dto);
  }

  @Get('accounts/:id/summary')
  @ApiOperation({ summary: 'خلاصه مغایرت (مانده دفاتر در برابر مانده بانک)' })
  @ApiResponse({ status: HttpStatus.OK, type: ReconciliationSummaryDto })
  async summary(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SummaryQueryDto,
  ): Promise<ReconciliationSummaryDto> {
    return this.bankingService.summary(this.tenantIdOf(request), id, query.asOf);
  }

  @Post('statement-lines/:id/match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تطبیق دستی سطر بانک با سطر سند' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementLineResponseDto })
  async match(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ManualMatchDto,
  ): Promise<StatementLineResponseDto> {
    return this.bankingService.manualMatch(this.tenantIdOf(request), id, dto.journalLineId);
  }

  @Delete('statement-lines/:id/match')
  @ApiOperation({ summary: 'لغو تطبیق سطر بانک' })
  @ApiResponse({ status: HttpStatus.OK, type: StatementLineResponseDto })
  async unmatch(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StatementLineResponseDto> {
    return this.bankingService.unmatch(this.tenantIdOf(request), id);
  }

  @Post('statement-lines/:id/journal-entry')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ساخت سند از سطر بانکِ تطبیق‌نخورده و تطبیق آن' })
  @ApiResponse({ status: HttpStatus.CREATED, type: StatementLineResponseDto })
  async createEntry(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEntryFromLineDto,
  ): Promise<StatementLineResponseDto> {
    return this.bankingService.createEntryFromLine(this.tenantIdOf(request), id, dto);
  }
}
