import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessModule } from '../../access/catalogue';
import { ModuleAccess } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { maxUploadBytes } from '../../data_import/constants/data-import.constants';
import { requireTenantId } from '../../tenants/tenant-context';
import {
  KartableReconcileBodyDto,
  KartableReconciliationResponseDto,
} from '../dto/kartable-reconciliation.dto';
import {
  KartableReconciliationService,
  UploadedKartableFile,
} from '../services/kartable-reconciliation.service';

interface KartableUploadedFilesMap {
  salesFile?: UploadedKartableFile[];
  purchasesFile?: UploadedKartableFile[];
}

/**
 * کنترلر تطبیق کارپوشه سامانه مودیان (فروش و خرید فصلی) با اسناد ثبت‌شده سازمان.
 * شناسه مستأجر فقط از توکن JWT خوانده می‌شود.
 */
@ApiTags('Tax Compliance - تطبیق کارپوشه مودیان')
@ModuleAccess(AccessModule.TAX)
@Controller('enterprise-hub/tax-compliance/kartable')
export class KartableReconciliationController {
  constructor(private readonly service: KartableReconciliationService) {}

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'تطبیق فایل خروجی کارپوشه مودیان (CSV/XLSX) با فاکتورهای فروش و خرید فصل',
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'salesFile', maxCount: 1 },
        { name: 'purchasesFile', maxCount: 1 },
      ],
      { limits: { fileSize: maxUploadBytes() } },
    ),
  )
  async reconcile(
    @Req() request: AuthenticatedRequest,
    @Body() body: KartableReconcileBodyDto,
    @UploadedFiles() files?: KartableUploadedFilesMap,
  ): Promise<KartableReconciliationResponseDto> {
    const tenantId = requireTenantId(request);
    return this.service.reconcile(tenantId, body.year, body.quarter, {
      salesFile: files?.salesFile?.[0],
      purchasesFile: files?.purchasesFile?.[0],
    });
  }
}
