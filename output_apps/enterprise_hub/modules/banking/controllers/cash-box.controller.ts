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
  CashBankTransferDto,
  CreateCashBoxDto,
  PosSettlementDto,
} from '../dto/cash-box.dto';
import { CashBoxService } from '../services/cash-box.service';

@ApiTags('Banking & Cash Boxes - صندوق و خزانه‌داری')
@ModuleAccess(AccessModule.BANKING)
@Controller('enterprise-hub/banking')
export class CashBoxController {
  constructor(private readonly cashBoxService: CashBoxService) {}

  @Get('cash-boxes')
  @ApiOperation({ summary: 'فهرست صندوق‌های نقدی سازمان' })
  @ApiResponse({ status: HttpStatus.OK })
  async list(@Req() request: AuthenticatedRequest) {
    return this.cashBoxService.listCashBoxes(requireTenantId(request));
  }

  @Post('cash-boxes')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'تعریف صندوق جدید متصل به حساب دفتر کل' })
  @ApiResponse({ status: HttpStatus.CREATED })
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateCashBoxDto,
  ) {
    return this.cashBoxService.createCashBox(requireTenantId(request), dto);
  }

  @Get('cash-boxes/:id')
  @ApiOperation({ summary: 'دریافت مشخصات یک صندوق' })
  @ApiResponse({ status: HttpStatus.OK })
  async get(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cashBoxService.getCashBox(requireTenantId(request), id);
  }

  @Post('transfers/cash-bank')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'ثبت انتقال وجه بین صندوق و حساب بانکی (واریز/برداشت)' })
  @ApiResponse({ status: HttpStatus.CREATED })
  async transfer(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CashBankTransferDto,
  ) {
    return this.cashBoxService.transferBetweenCashAndBank(
      requireTenantId(request),
      dto,
    );
  }

  @Post('pos-settlements')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'تسویه پایانه کارتخوان (پوز) با کسر کارمزد بانکی' })
  @ApiResponse({ status: HttpStatus.CREATED })
  async settlePos(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PosSettlementDto,
  ) {
    return this.cashBoxService.settlePos(requireTenantId(request), dto);
  }
}
