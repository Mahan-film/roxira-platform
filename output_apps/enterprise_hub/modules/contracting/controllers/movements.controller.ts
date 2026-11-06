import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateMovementDto } from '../dto/movement.dto';
import { MovementResponse, MovementService } from '../services/movement.service';

/** Advance payments and retention releases of a contract. Both post a voucher at once and are replay safe by `requestKey`. */
@ApiTags('Contracting - پیش‌پرداخت و سپرده')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/contracting/contracts/:contractId')
export class MovementsController {
  constructor(private readonly movements: MovementService) {}

  @Get('movements')
  @ApiOperation({ summary: 'پیش‌پرداخت‌ها و آزادسازی‌های سپرده یک قرارداد' })
  list(@Req() request: AuthenticatedRequest, @Param('contractId', ParseIntPipe) contractId: number): Promise<MovementResponse[]> {
    return this.movements.list(requireTenantId(request), contractId);
  }

  @Post('advances')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'ثبت و صدور سند پیش‌پرداخت (سقف قانونی نامشخص = رد)' })
  advance(@Req() request: AuthenticatedRequest, @Param('contractId', ParseIntPipe) contractId: number, @Body() dto: CreateMovementDto): Promise<MovementResponse> {
    return this.movements.advance(requireTenantId(request), contractId, dto);
  }

  @Post('retention-releases')
  @HttpCode(HttpStatus.CREATED)
  @RequireAction(AccessAction.POST)
  @ApiOperation({ summary: 'آزادسازی سپرده حسن انجام کار و صدور سند' })
  release(@Req() request: AuthenticatedRequest, @Param('contractId', ParseIntPipe) contractId: number, @Body() dto: CreateMovementDto): Promise<MovementResponse> {
    return this.movements.releaseRetention(requireTenantId(request), contractId, dto);
  }
}
