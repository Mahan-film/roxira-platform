import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { sniffFileKind } from '../../data_import/parsers/file-kind';
import { VoucherAttachmentResponseDto } from '../dto/voucher-attachment.dto';
import { PeriodLockedException } from '../exceptions/ledger.exceptions';
import {
  VoucherAttachmentRepository,
  VoucherAttachmentRow,
} from '../repositories/voucher-attachment.repository';

/** Same cap as bank-reconciliation attachments: evidence files are small. */
export const MAX_VOUCHER_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Same allow-list and stored content types as bank-reconciliation attachments. */
const ALLOWED_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  image: 'image/*',
  xlsx: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

export interface UploadedVoucherFile {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
}

export interface VoucherAttachmentFile {
  fileName: string;
  contentType: string;
  content: Buffer;
}

/** Strips path separators and control/quote characters; keeps letters, digits, dot, dash and space. */
export function sanitizeAttachmentName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, '_')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .trim();
  return (cleaned || 'attachment').slice(0, 255);
}

/**
 * Journal-entry (voucher) attachments. Uploading, listing and downloading are allowed on every
 * voucher state, including POSTED, because evidence often arrives after posting. Deleting is a
 * soft delete and is refused while the voucher's date sits inside a locked accounting period.
 */
@Injectable()
export class VoucherAttachmentService {
  constructor(private readonly repository: VoucherAttachmentRepository) {}

  private toView(row: VoucherAttachmentRow): VoucherAttachmentResponseDto {
    return {
      id: row.id,
      journalEntryId: row.journal_entry_id,
      fileName: row.file_name,
      contentType: row.content_type,
      sizeBytes: row.size_bytes,
      uploadedBy: row.uploaded_by,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** The voucher must belong to this tenant; otherwise the route behaves as if it did not exist. */
  private async requireEntry(tenantId: string, journalEntryId: number): Promise<void> {
    const entry = await this.repository.findEntry(tenantId, journalEntryId);
    if (!entry) {
      throw new NotFoundException(`سند حسابداری با شناسه ${journalEntryId} یافت نشد.`);
    }
  }

  async upload(
    tenantId: string,
    actor: string,
    journalEntryId: number,
    file: UploadedVoucherFile | undefined,
  ): Promise<VoucherAttachmentResponseDto> {
    await this.requireEntry(tenantId, journalEntryId);
    if (!file || file.buffer.length === 0) {
      throw new BadRequestException('فایل ارسال نشده است.');
    }
    if (file.buffer.length > MAX_VOUCHER_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeException('حجم پیوست بیش از ۵ مگابایت است.');
    }
    const kind = sniffFileKind(file.buffer, file.originalname, file.mimetype ?? '');
    const contentType = ALLOWED_MIME[kind];
    if (!contentType) {
      throw new BadRequestException('نوع پیوست پشتیبانی نمی‌شود (PDF، تصویر، Excel یا CSV).');
    }
    const row = await this.repository.insert(tenantId, {
      journalEntryId,
      fileName: sanitizeAttachmentName(file.originalname),
      contentType,
      content: file.buffer,
      uploadedBy: actor,
    });
    return this.toView(row);
  }

  async list(tenantId: string, journalEntryId: number): Promise<VoucherAttachmentResponseDto[]> {
    await this.requireEntry(tenantId, journalEntryId);
    const rows = await this.repository.list(tenantId, journalEntryId);
    return rows.map((row) => this.toView(row));
  }

  async download(tenantId: string, journalEntryId: number, attachmentId: number): Promise<VoucherAttachmentFile> {
    await this.requireEntry(tenantId, journalEntryId);
    const row = await this.repository.findContent(tenantId, journalEntryId, attachmentId);
    if (!row) {
      throw new NotFoundException(`پیوست با شناسه ${attachmentId} یافت نشد.`);
    }
    return { fileName: row.file_name, contentType: row.content_type, content: row.content };
  }

  async remove(tenantId: string, journalEntryId: number, attachmentId: number): Promise<void> {
    const entry = await this.repository.findEntry(tenantId, journalEntryId);
    if (!entry) {
      throw new NotFoundException(`سند حسابداری با شناسه ${journalEntryId} یافت نشد.`);
    }
    const attachment = await this.repository.findOne(tenantId, journalEntryId, attachmentId);
    if (!attachment) {
      throw new NotFoundException(`پیوست با شناسه ${attachmentId} یافت نشد.`);
    }
    if (await this.repository.isPeriodLocked(tenantId, entry.date)) {
      throw new PeriodLockedException('حذف پیوست در دورهٔ قفل‌شده مجاز نیست.');
    }
    await this.repository.softDelete(tenantId, journalEntryId, attachmentId);
  }
}
