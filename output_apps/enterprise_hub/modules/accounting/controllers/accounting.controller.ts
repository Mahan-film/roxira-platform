import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountLedgerResponseDto } from '../dto/account-ledger-response.dto';
import { AccountResponseDto } from '../dto/account-response.dto';
import { CreateAccountDto } from '../dto/create-account.dto';
import { CreateJournalEntryDto } from '../dto/create-journal-entry.dto';
import {
  JournalEntryResponseDto,
  PaginatedJournalEntryResponseDto,
} from '../dto/journal-entry-response.dto';
import {
  QueryAccountLedgerDto,
  QueryJournalEntryDto,
} from '../dto/query-journal-entry.dto';
import { TrialBalanceResponseDto } from '../dto/trial-balance-response.dto';
import { AccountingService } from '../services/accounting.service';

/**
 * کنترلر دفتر کل و حسابداری دوطرفه.
 * فقط مسیریابی و اعتبارسنجی HTTP؛ هیچ منطق کسب‌وکار یا دسترسی مستقیم به
 * پایگاه‌داده در این لایه وجود ندارد (Rule #3 — AGENTS.md).
 */
@ApiTags('Accounting - حسابداری و دفتر روزنامه')
@Controller('enterprise-hub/accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'فهرست حساب‌های دفتر کل (Chart of Accounts)' })
  @ApiResponse({ status: HttpStatus.OK, type: [AccountResponseDto] })
  async listAccounts(): Promise<AccountResponseDto[]> {
    return this.accountingService.listAccounts();
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ایجاد حساب جدید در دفتر کل' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AccountResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'کد حساب تکراری' })
  async createAccount(
    @Body() dto: CreateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountingService.createAccount(dto);
  }

  @Post('journal-entries')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ثبت سند حسابداری دوطرفه',
    description:
      'ثبت سند تراز با کنترل برابری جمع بدهکار و بستانکار، یکتایی شماره سند و وجود کدهای حساب.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: JournalEntryResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'سند ناتراز یا ورودی نامعتبر' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'شماره سند تکراری' })
  async createJournalEntry(
    @Body() dto: CreateJournalEntryDto,
  ): Promise<JournalEntryResponseDto> {
    return this.accountingService.createJournalEntry(dto);
  }

  @Get('journal-entries')
  @ApiOperation({ summary: 'فهرست صفحه‌بندی‌شده اسناد دفتر روزنامه' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedJournalEntryResponseDto })
  async listJournalEntries(
    @Query() query: QueryJournalEntryDto,
  ): Promise<PaginatedJournalEntryResponseDto> {
    return this.accountingService.findAllJournalEntries(query);
  }

  @Get('journal-entries/:id')
  @ApiOperation({ summary: 'دریافت یک سند حسابداری بر اساس شناسه' })
  @ApiResponse({ status: HttpStatus.OK, type: JournalEntryResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سند یافت نشد' })
  async getJournalEntry(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<JournalEntryResponseDto> {
    return this.accountingService.findOneJournalEntry(id);
  }

  @Get('trial-balance')
  @ApiOperation({
    summary: 'تراز آزمایشی دفتر کل',
    description: 'جمع بدهکار/بستانکار هر حساب و کنترل تراز بودن کل دفاتر.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TrialBalanceResponseDto })
  async getTrialBalance(): Promise<TrialBalanceResponseDto> {
    return this.accountingService.getTrialBalance();
  }

  @Get('accounts/:code/ledger')
  @ApiOperation({
    summary: 'گردش حساب (دفتر معین)',
    description: 'ریزدگردش یک حساب به همراه مانده افتتاح، اختتام و مانده تجمعی.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: AccountLedgerResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'حساب یافت نشد' })
  async getAccountLedger(
    @Param('code') code: string,
    @Query() query: QueryAccountLedgerDto,
  ): Promise<AccountLedgerResponseDto> {
    return this.accountingService.getAccountLedger(code, query);
  }
}