import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { CreatePosSaleDto, PosSaleResponseDto } from '../dto/pos-sale.dto';
import { PosSaleService } from '../services/pos-sale.service';

/** Quick sale at the counter (and the entry point a POS API will call). Tenant comes only from the token. */
@ApiTags('Invoicing - فروش سریع و صندوق')
@ApiBearerAuth()
@ModuleAccess(AccessModule.INVOICING)
@Controller('enterprise-hub/invoicing/pos-sales')
export class PosSalesController {
  constructor(private readonly posSales: PosSaleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'ثبت فروش سریع با کلید یکتا',
    description:
      'مشتری اختیاری است (بدون مشخصات: مشتری گذری). پرداخت و ثبت حسابداری و انبار خودکار است؛ تکرار با همان کلید همان صورتحساب را برمی‌گرداند.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: PosSaleResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'کلید برای فروش دیگری استفاده شده' })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreatePosSaleDto): Promise<PosSaleResponseDto> {
    return this.posSales.createSale(requireTenantId(request), dto);
  }
}
