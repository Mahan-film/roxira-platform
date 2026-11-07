import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessAction, AccessModule } from '../../access/catalogue';
import { ModuleAccess, RequireAction } from '../../access/decorators';
import { AuthenticatedRequest } from '../../auth/guards/jwt-auth.guard';
import { requireTenantId } from '../../tenants/tenant-context';
import { VoucherAttachmentResponseDto } from '../dto/voucher-attachment.dto';
import {
  MAX_VOUCHER_ATTACHMENT_BYTES,
  UploadedVoucherFile,
  VoucherAttachmentService,
} from '../services/voucher-attachment.service';

/**
 * پیوست‌های سند حسابداری (voucher attachments).
 *
 * The tenant comes only from the verified JWT; AccessGuard checks `accounting:create` for upload
 * and delete, `accounting:read` for list and download. Another tenant's voucher (or an attachment
 * id paired with a voucher that does not own it) is answered as 404.
 */
@ApiTags('Accounting - پیوست‌های سند')
@ModuleAccess(AccessModule.ACCOUNTING)
@Controller('enterprise-hub/accounting')
export class VoucherAttachmentController {
  constructor(private readonly attachments: VoucherAttachmentService) {}

  private actor(request: AuthenticatedRequest): { tenantId: string; actor: string } {
    return { tenantId: requireTenantId(request), actor: String(request.user?.sub ?? 'unknown').slice(0, 64) };
  }

  @RequireAction(AccessAction.CREATE)
  @Post('journal-entries/:id/attachments')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'بارگذاری پیوست برای سند (PDF، تصویر، Excel یا CSV؛ حداکثر ۵ مگابایت)' })
  @ApiResponse({ status: HttpStatus.CREATED, type: VoucherAttachmentResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سند یافت نشد' })
  @ApiResponse({ status: HttpStatus.PAYLOAD_TOO_LARGE, description: 'حجم فایل بیش از ۵ مگابایت' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VOUCHER_ATTACHMENT_BYTES } }))
  upload(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: UploadedVoucherFile | undefined,
  ): Promise<VoucherAttachmentResponseDto> {
    const { tenantId, actor } = this.actor(request);
    if (!file) {
      throw new BadRequestException('فایل ارسال نشده است.');
    }
    return this.attachments.upload(tenantId, actor, id, file);
  }

  @Get('journal-entries/:id/attachments')
  @ApiOperation({ summary: 'فهرست پیوست‌های سند' })
  @ApiResponse({ status: HttpStatus.OK, type: [VoucherAttachmentResponseDto] })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سند یافت نشد' })
  list(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<VoucherAttachmentResponseDto[]> {
    return this.attachments.list(requireTenantId(request), id);
  }

  @Get('journal-entries/:id/attachments/:attachmentId/download')
  @ApiOperation({ summary: 'دانلود پیوست سند' })
  @ApiResponse({ status: HttpStatus.OK, description: 'محتوای فایل' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سند یا پیوست یافت نشد' })
  async download(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.attachments.download(requireTenantId(request), id, attachmentId);
    // Always an attachment, never inline, so an uploaded HTML/SVG file can never execute.
    const fallback = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.content);
  }

  @RequireAction(AccessAction.CREATE)
  @Delete('journal-entries/:id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'حذف نرم پیوست سند (در دورهٔ قفل‌شده مجاز نیست)' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'سند یا پیوست یافت نشد' })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
  ): Promise<void> {
    await this.attachments.remove(requireTenantId(request), id, attachmentId);
  }
}
