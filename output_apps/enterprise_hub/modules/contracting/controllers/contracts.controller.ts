import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { ContractListResponseDto, ContractResponseDto, CreateContractDto, QueryContractsDto, UpdateContractDto } from '../dto/contract.dto';
import { ContractService } from '../services/contract.service';

/** Contracts (قرارداد), employer side or contractor side. The tenant comes only from the verified JWT claim. */
@ApiTags('Contracting - قرارداد')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/contracting/contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست قراردادها' })
  @ApiResponse({ status: HttpStatus.OK, type: ContractListResponseDto })
  list(@Req() request: AuthenticatedRequest, @Query() query: QueryContractsDto): Promise<ContractListResponseDto> {
    return this.contracts.list(requireTenantId(request), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'یک قرارداد' })
  @ApiResponse({ status: HttpStatus.OK, type: ContractResponseDto })
  getById(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number): Promise<ContractResponseDto> {
    return this.contracts.getById(requireTenantId(request), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت قرارداد' })
  @ApiResponse({ status: HttpStatus.CREATED, type: ContractResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateContractDto): Promise<ContractResponseDto> {
    return this.contracts.create(requireTenantId(request), dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'ویرایش قرارداد (کد، سمت و طرف حساب تغییرپذیر نیستند)' })
  @ApiResponse({ status: HttpStatus.OK, type: ContractResponseDto })
  update(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContractDto): Promise<ContractResponseDto> {
    return this.contracts.update(requireTenantId(request), id, dto);
  }
}
