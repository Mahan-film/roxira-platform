import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess, AlsoAllowModule } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreatePartyDto, PartyListResponseDto, PartyResponseDto, QueryPartiesDto, UpdatePartyDto } from '../dto/party.dto';
import { PartiesService } from '../services/parties.service';

/**
 * Party master (طرف حساب). Gated by the CRM module permissions; reads (list and
 * by-code) are also open through the ACCOUNTING module, so an accountant with
 * accounting:read can read parties. The tenant comes only from the
 * verified JWT claim. No delete route: parties are deactivated with `active = false`.
 */
@ApiTags('Parties - طرف حساب')
@ModuleAccess(AccessModule.CRM)
@Controller('enterprise-hub/parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  @Get()
  @ApiOperation({ summary: 'فهرست طرف حساب‌ها با فیلتر نقش، وضعیت و جست‌وجو' })
  @ApiResponse({ status: HttpStatus.OK, type: PartyListResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  list(@Req() request: AuthenticatedRequest, @Query() query: QueryPartiesDto): Promise<PartyListResponseDto> {
    return this.partiesService.list(requireTenantId(request), query);
  }

  @Get('by-code/:code')
  @ApiOperation({ summary: 'یک طرف حساب با کد' })
  @ApiResponse({ status: HttpStatus.OK, type: PartyResponseDto })
  @AlsoAllowModule(AccessModule.ACCOUNTING)
  getByCode(@Req() request: AuthenticatedRequest, @Param('code') code: string): Promise<PartyResponseDto> {
    return this.partiesService.getByCode(requireTenantId(request), code);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ثبت طرف حساب جدید (مشتری، تامین‌کننده یا هر دو)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: PartyResponseDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreatePartyDto): Promise<PartyResponseDto> {
    return this.partiesService.create(requireTenantId(request), dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'ویرایش طرف حساب (کد تغییرپذیر نیست)' })
  @ApiResponse({ status: HttpStatus.OK, type: PartyResponseDto })
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePartyDto,
  ): Promise<PartyResponseDto> {
    return this.partiesService.update(requireTenantId(request), id, dto);
  }
}
