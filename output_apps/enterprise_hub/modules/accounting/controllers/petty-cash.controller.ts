import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  CreatePettyCashExpenseDto,
  CreatePettyCashFundDto,
  PettyCashFundResponseDto,
  PettyCashMovementDto,
  PettyCashStatementDto,
  PettyCashTransactionResponseDto,
  SettlePettyCashDto,
} from '../dto/petty-cash.dto';
import { PettyCashService } from '../services/petty-cash.service';

/** Petty cash of the JWT tenant. Receipts need `create`; anything that posts needs `post`. */
@ApiTags('Accounting - تنخواه')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting/petty-cash')
export class PettyCashController {
  constructor(private readonly pettyCash: PettyCashService) {}

  private actorOf(request: AuthenticatedRequest): string {
    return String(request.user?.sub ?? 'unknown').slice(0, 64);
  }

  @Get('funds')
  @ApiOperation({ summary: 'فهرست تنخواه‌ها با مانده دفتر' })
  @ApiResponse({ status: HttpStatus.OK, type: [PettyCashFundResponseDto] })
  list(@Req() request: AuthenticatedRequest): Promise<PettyCashFundResponseDto[]> {
    return this.pettyCash.listFunds(requireTenantId(request));
  }

  @Post('funds')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف تنخواه و مسئول آن' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PettyCashFundResponseDto })
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreatePettyCashFundDto,
  ): Promise<PettyCashFundResponseDto> {
    return this.pettyCash.createFund(requireTenantId(request), dto);
  }

  @Get('funds/:id')
  @ApiOperation({ summary: 'صورت تنخواه' })
  @ApiResponse({ status: HttpStatus.OK, type: PettyCashStatementDto })
  statement(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PettyCashStatementDto> {
    return this.pettyCash.statement(requireTenantId(request), id);
  }

  @RequireAction(AccessAction.POST)
  @Post('funds/:id/charge')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'شارژ تنخواه از بانک یا صندوق' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PettyCashTransactionResponseDto })
  charge(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PettyCashMovementDto,
  ): Promise<PettyCashTransactionResponseDto> {
    return this.pettyCash.charge(requireTenantId(request), this.actorOf(request), id, dto);
  }

  @RequireAction(AccessAction.POST)
  @Post('funds/:id/return')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'برگشت وجه تنخواه به بانک یا صندوق' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PettyCashTransactionResponseDto })
  returnCash(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PettyCashMovementDto,
  ): Promise<PettyCashTransactionResponseDto> {
    return this.pettyCash.returnCash(requireTenantId(request), this.actorOf(request), id, dto);
  }

  @Post('funds/:id/expenses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت رسید هزینه تنخواه (بدون ثبت در دفتر تا تسویه)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PettyCashTransactionResponseDto })
  addExpense(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreatePettyCashExpenseDto,
  ): Promise<PettyCashTransactionResponseDto> {
    return this.pettyCash.addExpense(requireTenantId(request), this.actorOf(request), id, dto);
  }

  @Post('funds/:id/expenses/:expenseId/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ابطال رسید تسویه‌نشده' })
  @ApiResponse({ status: HttpStatus.OK, type: PettyCashTransactionResponseDto })
  voidExpense(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('expenseId', ParseIntPipe) expenseId: number,
  ): Promise<PettyCashTransactionResponseDto> {
    return this.pettyCash.voidExpense(requireTenantId(request), id, expenseId);
  }

  @RequireAction(AccessAction.POST)
  @Post('funds/:id/settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'تسویه رسیدها در دفتر و جبران اختیاری تنخواه' })
  @ApiResponse({ status: HttpStatus.OK, type: PettyCashStatementDto })
  settle(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SettlePettyCashDto,
  ): Promise<PettyCashStatementDto> {
    return this.pettyCash.settle(requireTenantId(request), this.actorOf(request), id, dto);
  }

  @RequireAction(AccessAction.APPROVE)
  @Post('funds/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'بستن تنخواه با مانده صفر' })
  @ApiResponse({ status: HttpStatus.OK, type: PettyCashFundResponseDto })
  close(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PettyCashFundResponseDto> {
    return this.pettyCash.closeFund(requireTenantId(request), id);
  }
}
