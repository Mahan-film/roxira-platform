import { Injectable } from '@nestjs/common';
import { PartyRole } from '../../parties/enums/party-role.enum';
import { PartyInput } from '../../parties/repositories/parties.repository';
import { PartiesService } from '../../parties/services/parties.service';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  ImportOwnerId,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

/** رجیستری ورود داده طرف‌حساب‌ها (مشتری/تأمین‌کننده)؛ کلید یکتا: کد طرف حساب در هر سازمان. */
@Injectable()
export class PartiesRegistry implements EntityImportAdapter {
  readonly key = 'parties';
  readonly labelFa = 'طرف‌حساب‌ها (مشتری و تأمین‌کننده)';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'code',
      labelFa: 'کد طرف حساب',
      required: true,
      type: 'text',
      synonyms: [
        'code',
        'party code',
        'کد طرف حساب',
        'کد طرف‌حساب',
        'کد تفصیلی',
        'کد مشتری',
        'کد تامین کننده',
        'کد تأمین‌کننده',
        'PartyCode',
        'CustomerCode',
      ],
    },
    {
      key: 'name',
      labelFa: 'نام طرف حساب',
      required: true,
      type: 'text',
      synonyms: [
        'name',
        'party name',
        'نام طرف حساب',
        'نام و نام خانوادگی',
        'نام مشتری',
        'نام تأمین‌کننده',
        'نام تامین کننده',
        'نام',
      ],
    },
    {
      key: 'role',
      labelFa: 'نقش',
      required: true,
      type: 'enum',
      enumValues: [PartyRole.CUSTOMER, PartyRole.SUPPLIER, PartyRole.BOTH],
      enumAliases: {
        مشتری: PartyRole.CUSTOMER,
        خریدار: PartyRole.CUSTOMER,
        customer: PartyRole.CUSTOMER,
        buyer: PartyRole.CUSTOMER,
        'تأمین‌کننده': PartyRole.SUPPLIER,
        'تامین‌کننده': PartyRole.SUPPLIER,
        'تأمین کننده': PartyRole.SUPPLIER,
        'تامین کننده': PartyRole.SUPPLIER,
        فروشنده: PartyRole.SUPPLIER,
        supplier: PartyRole.SUPPLIER,
        vendor: PartyRole.SUPPLIER,
        'هر دو': PartyRole.BOTH,
        'مشتری و تأمین‌کننده': PartyRole.BOTH,
        'مشتری و تامین کننده': PartyRole.BOTH,
        both: PartyRole.BOTH,
      },
      synonyms: ['role', 'type', 'party type', 'نقش', 'نوع طرف حساب', 'نوع'],
    },
    {
      key: 'nationalId',
      labelFa: 'شناسه ملی',
      required: false,
      type: 'text',
      synonyms: [
        'national id',
        'شناسه ملی',
        'کد ملی',
        'شناسه ملی / کد اقتصادی',
        'شناسه ملی / کد اقتصادی آزمایشی',
        'NationalCode',
      ],
    },
    {
      key: 'economicCode',
      labelFa: 'کد اقتصادی',
      required: false,
      type: 'text',
      synonyms: ['economic code', 'کد اقتصادی', 'EconomicCode'],
    },
    {
      key: 'phone',
      labelFa: 'تلفن',
      required: false,
      type: 'phone',
      synonyms: ['phone', 'mobile', 'تلفن', 'موبایل', 'شماره تماس', 'همراه'],
    },
    {
      key: 'email',
      labelFa: 'ایمیل',
      required: false,
      type: 'email',
      synonyms: ['email', 'رایانامه', 'ایمیل', 'پست الکترونیک'],
    },
  ];

  constructor(private readonly partiesService: PartiesService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const code = record.values.code;
    if (typeof code === 'string' && code.trim()) {
      return [`code:${code.trim()}`];
    }
    return [];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const codes = keys
      .filter((k) => k.startsWith('code:'))
      .map((k) => k.slice(5));
    if (codes.length === 0) return [];
    const found = await this.partiesService.findExistingCodes(tenantId, codes);
    return found.map((c) => `code:${c}`);
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const inserted: CommitRowResult[] = [];
    const failed: { rowNumber: number; message: string }[] = [];
    const validInputs: PartyInput[] = [];
    const rowToCode = new Map<number, string>();

    for (const record of records) {
      const { rowNumber, values } = record;
      const code = String(values.code ?? '').trim();
      const name = String(values.name ?? '').trim();
      const role = values.role as PartyRole;
      const nationalId = values.nationalId ? String(values.nationalId).trim() : null;
      const economicCode = values.economicCode ? String(values.economicCode).trim() : null;
      const phone = values.phone ? String(values.phone).trim() : null;
      const email = values.email ? String(values.email).trim() : null;

      if (nationalId && !/^\d{10,11}$/.test(nationalId)) {
        failed.push({
          rowNumber,
          message: 'شناسه ملی باید فقط رقم و ۱۰ یا ۱۱ رقم باشد.',
        });
        continue;
      }

      if (economicCode && !/^\d{10,14}$/.test(economicCode)) {
        failed.push({
          rowNumber,
          message: 'کد اقتصادی باید فقط رقم و بین ۱۰ تا ۱۴ رقم باشد.',
        });
        continue;
      }

      validInputs.push({
        code,
        name,
        role,
        nationalId,
        economicCode,
        phone,
        email,
      });
      rowToCode.set(rowNumber, code);
    }

    if (validInputs.length > 0) {
      const results = await this.partiesService.upsertMany(tenantId, validInputs);
      const resultMap = new Map(results.map((r) => [r.code, r]));

      for (const record of records) {
        const code = rowToCode.get(record.rowNumber);
        if (!code) continue;

        const res = resultMap.get(code);
        if (res) {
          if (res.inserted) {
            inserted.push({ rowNumber: record.rowNumber, ownerId: res.id });
          } else {
            failed.push({
              rowNumber: record.rowNumber,
              message: 'کد طرف حساب قبلاً ثبت شده است.',
            });
          }
        }
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: ImportOwnerId[]): Promise<UndoOutcome> {
    const removed = await this.partiesService.removeByIds(
      tenantId,
      ownerIds as number[],
    );
    return { removed, refused: [] };
  }
}
