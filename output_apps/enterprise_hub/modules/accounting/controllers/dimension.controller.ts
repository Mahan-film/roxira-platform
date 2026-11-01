import { Body, Controller, Get, HttpCode, HttpStatus, ParseEnumPipe, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreateDimensionDto, DimensionBalancesQueryDto, DimensionListQueryDto } from '../dto/dimension.dto';
import { DimensionKind } from '../enums/accounting.enum';
import { DimensionService } from '../services/dimension.service';

/** Floating details, cost centres and project centres of the JWT tenant. */
@ApiTags('Accounting - تفصیلی شناور و مراکز هزینه و پروژه')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting/dimensions')
export class DimensionController {
  constructor(private readonly dimensions: DimensionService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست تفصیلی‌های شناور، مراکز هزینه و پروژه' })
  @ApiResponse({ status: HttpStatus.OK })
  list(@Req() request: AuthenticatedRequest, @Query() query: DimensionListQueryDto) {
    return this.dimensions.list(requireTenantId(request), query.kind);
  }

  @RequireAction(AccessAction.CREATE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'تعریف تفصیلی شناور، مرکز هزینه یا مرکز پروژه' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'کد تکراری' })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateDimensionDto) {
    return this.dimensions.create(requireTenantId(request), dto);
  }

  @Get(':kind/balances')
  @ApiOperation({ summary: 'گردش و مانده هر تفصیلی، مرکز هزینه یا پروژه در بازه' })
  @ApiResponse({ status: HttpStatus.OK })
  balances(
    @Req() request: AuthenticatedRequest,
    @Param('kind', new ParseEnumPipe(DimensionKind)) kind: DimensionKind,
    @Query() query: DimensionBalancesQueryDto,
  ) {
    return this.dimensions.balances(requireTenantId(request), kind, query);
  }
}
