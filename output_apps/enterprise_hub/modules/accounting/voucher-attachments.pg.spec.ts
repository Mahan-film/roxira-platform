/**
 * Voucher attachments on a REAL PostgreSQL. Opt-in like the other pg specs: skipped unless
 * ROXIRA_TEST_PG_HOST is set; each run creates and drops its own database.
 */
import 'reflect-metadata';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { CurrencyService } from '../currency/services/currency.service';
import { JournalEntryStatus } from './enums/accounting.enum';
import { AccountingRepository } from './repositories/accounting.repository';
import { VoucherAttachmentRepository } from './repositories/voucher-attachment.repository';
import { AccountingService } from './services/accounting.service';
import {
  MAX_VOUCHER_ATTACHMENT_BYTES,
  sanitizeAttachmentName,
  VoucherAttachmentService,
} from './services/voucher-attachment.service';
import {
  createTestDatabase,
  describePg,
  TestDatabaseContext,
  TEST_T1 as T1,
  TEST_T2 as T2,
} from '../../test/support/test-pg';

const pdf = (marker: string): Buffer => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(marker)]);

describePg('Voucher attachments on PostgreSQL', () => {
  let testDb: TestDatabaseContext;
  let accounting: AccountingService;
  let attachments: VoucherAttachmentService;

  const makeEntry = (
    tenant: string,
    entryNumber: string,
    date = '2026-05-01',
    status = JournalEntryStatus.POSTED,
  ) =>
    accounting.createJournalEntry(tenant, {
      entryNumber,
      date,
      description: 'voucher',
      status,
      lines: [
        { accountCode: '1010', debit: 100 },
        { accountCode: '4010', credit: 100 },
      ],
    } as never);

  beforeAll(async () => {
    testDb = await createTestDatabase('va');
    const currency = { convert: (v: number) => v, round: (v: number) => v } as unknown as CurrencyService;
    accounting = new AccountingService(new AccountingRepository(testDb.scope), currency);
    attachments = new VoucherAttachmentService(new VoucherAttachmentRepository(testDb.scope));
  }, 120000);

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it('uploads, lists and downloads the exact same bytes', async () => {
    const entry = await makeEntry(T1, 'VA-1');
    const bytes = pdf('receipt-body');

    const uploaded = await attachments.upload(T1, 'u-1', entry.id, {
      buffer: bytes,
      originalname: 'receipt.pdf',
      mimetype: 'application/pdf',
    });
    expect(uploaded.sizeBytes).toBe(bytes.length);
    expect(uploaded.contentType).toBe('application/pdf');

    const listed = await attachments.list(T1, entry.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: uploaded.id, sizeBytes: bytes.length, fileName: 'receipt.pdf' });

    const downloaded = await attachments.download(T1, entry.id, uploaded.id);
    expect(downloaded.fileName).toBe('receipt.pdf');
    expect(Buffer.compare(downloaded.content, bytes)).toBe(0);
  });

  it('refuses a file over the 5 MB cap and a disallowed type', async () => {
    const entry = await makeEntry(T1, 'VA-2');
    await expect(
      attachments.upload(T1, 'u-1', entry.id, {
        buffer: Buffer.alloc(MAX_VOUCHER_ATTACHMENT_BYTES + 1, 0x61),
        originalname: 'big.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    await expect(
      attachments.upload(T1, 'u-1', entry.id, {
        buffer: Buffer.from('just text'),
        originalname: 'note.txt',
        mimetype: 'text/plain',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await attachments.list(T1, entry.id)).toHaveLength(0);
  });

  it('allows an attachment on a POSTED voucher', async () => {
    const entry = await makeEntry(T1, 'VA-POSTED', '2026-05-02');
    expect(entry.status).toBe('POSTED');
    const uploaded = await attachments.upload(T1, 'u-1', entry.id, {
      buffer: pdf('late-evidence'),
      originalname: 'late.pdf',
      mimetype: 'application/pdf',
    });
    expect((await attachments.list(T1, entry.id)).map((a) => a.id)).toEqual([uploaded.id]);
  });

  it('returns 404 for every route of another tenant', async () => {
    const entry = await makeEntry(T1, 'VA-3');
    const uploaded = await attachments.upload(T1, 'u-1', entry.id, {
      buffer: pdf('private'),
      originalname: 'private.pdf',
      mimetype: 'application/pdf',
    });

    await expect(
      attachments.upload(T2, 'u-2', entry.id, {
        buffer: pdf('x'),
        originalname: 'x.pdf',
        mimetype: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(attachments.list(T2, entry.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(attachments.download(T2, entry.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(attachments.remove(T2, entry.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 when an attachment id is paired with another voucher that the tenant owns', async () => {
    const owner = await makeEntry(T1, 'VA-OWNER');
    const other = await makeEntry(T1, 'VA-OTHER');
    const uploaded = await attachments.upload(T1, 'u-1', owner.id, {
      buffer: pdf('owner'),
      originalname: 'owner.pdf',
      mimetype: 'application/pdf',
    });

    await expect(attachments.download(T1, other.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(attachments.remove(T1, other.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);
    // A fresh voucher of the attacker's own tenant does not unlock a guessed attachment id either.
    const own = await makeEntry(T2, 'VA-OWN-T2');
    await expect(attachments.download(T2, own.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('soft-deletes: the attachment disappears from the list and download, and stays deleted', async () => {
    const entry = await makeEntry(T1, 'VA-DEL');
    const uploaded = await attachments.upload(T1, 'u-1', entry.id, {
      buffer: pdf('to-delete'),
      originalname: 'delete-me.pdf',
      mimetype: 'application/pdf',
    });

    await attachments.remove(T1, entry.id, uploaded.id);
    expect(await attachments.list(T1, entry.id)).toHaveLength(0);
    await expect(attachments.download(T1, entry.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(attachments.remove(T1, entry.id, uploaded.id)).rejects.toBeInstanceOf(NotFoundException);

    const rows = (await testDb.rawQuery(
      `SELECT deleted_at FROM erp_journal_entry_attachments WHERE tenant_id = $1 AND id = $2`,
      [T1, uploaded.id],
    )) as Array<{ deleted_at: Date | null }>;
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it('refuses to delete an attachment of a voucher dated in a locked period', async () => {
    const entry = await makeEntry(T1, 'VA-LOCK', '2026-08-10');
    const uploaded = await attachments.upload(T1, 'u-1', entry.id, {
      buffer: pdf('locked'),
      originalname: 'locked.pdf',
      mimetype: 'application/pdf',
    });
    await accounting.lockPeriod(T1, 'u-1', { periodStart: '2026-08-01', periodEnd: '2026-08-31' } as never);

    await expect(attachments.remove(T1, entry.id, uploaded.id)).rejects.toMatchObject({ status: 423 });
    // The soft delete did not happen.
    expect((await attachments.list(T1, entry.id)).map((a) => a.id)).toEqual([uploaded.id]);
  });

  it('sanitises path separators and quotes out of the stored file name', () => {
    expect(sanitizeAttachmentName('../../etc/pas"swd.pdf')).toBe('.._.._etc_pas_swd.pdf');
    expect(sanitizeAttachmentName('رسید پرداخت.pdf')).toBe('رسید پرداخت.pdf');
  });
});
