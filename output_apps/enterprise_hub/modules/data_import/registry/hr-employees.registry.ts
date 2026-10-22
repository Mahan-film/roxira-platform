import { Injectable } from '@nestjs/common';
import { Gender, MaritalStatus } from '../../hr/enums/hr.enum';
import {
  HrImportEmployeeInput,
  HrService,
} from '../../hr/services/hr.service';
import {
  AdapterCommitResult,
  CommitRowResult,
  EntityImportAdapter,
  ImportFieldDefinition,
  NormalisedRecord,
  UndoOutcome,
} from './import-registry.types';

const GENDER_ALIASES: Record<string, string> = {
  مرد: Gender.MALE,
  زن: Gender.FEMALE,
  مذکر: Gender.MALE,
  مؤنث: Gender.FEMALE,
};

const MARITAL_STATUS_ALIASES: Record<string, string> = {
  مجرد: MaritalStatus.SINGLE,
  متأهل: MaritalStatus.MARRIED,
  'متاهل': MaritalStatus.MARRIED,
  تاهل: MaritalStatus.MARRIED,
};

/** رجیستری ورود داده کارمندان منابع انسانی. */
@Injectable()
export class HrEmployeesRegistry implements EntityImportAdapter {
  readonly key = 'hr-employees';
  readonly labelFa = 'کارمندان (منابع انسانی)';

  readonly fields: readonly ImportFieldDefinition[] = [
    {
      key: 'employeeNumber',
      labelFa: 'کد پرسنلی',
      required: false,
      type: 'text',
      synonyms: [
        'employeeNumber',
        'employee number',
        'personnel number',
        'personnel code',
        'staff number',
        'کد پرسنلی',
        'شماره پرسنلی',
        'کد کارمندی',
        'شماره کارمندی',
      ],
    },
    {
      key: 'nationalId',
      labelFa: 'کد ملی',
      required: true,
      type: 'national_id',
      synonyms: [
        'nationalId',
        'national id',
        'national code',
        'melli code',
        'کد ملی',
        'شماره ملی',
        'کد ملی کارمند',
      ],
    },
    {
      key: 'firstName',
      labelFa: 'نام',
      required: true,
      type: 'text',
      synonyms: ['firstName', 'first name', 'given name', 'نام', 'نام کوچک'],
    },
    {
      key: 'lastName',
      labelFa: 'نام خانوادگی',
      required: true,
      type: 'text',
      synonyms: [
        'lastName',
        'last name',
        'surname',
        'family',
        'family name',
        'نام خانوادگی',
        'فامیل',
        'فامیلی',
      ],
    },
    {
      key: 'fatherName',
      labelFa: 'نام پدر',
      required: false,
      type: 'text',
      synonyms: ['fatherName', 'father name', 'father', 'نام پدر'],
    },
    {
      key: 'birthDate',
      labelFa: 'تاریخ تولد',
      required: false,
      type: 'date',
      synonyms: [
        'birthDate',
        'birth date',
        'date of birth',
        'dob',
        'تاریخ تولد',
        'تولد',
      ],
    },
    {
      key: 'gender',
      labelFa: 'جنسیت',
      required: false,
      type: 'enum',
      enumValues: Object.values(Gender),
      enumAliases: GENDER_ALIASES,
      synonyms: ['gender', 'sex', 'جنسیت'],
    },
    {
      key: 'mobile',
      labelFa: 'شماره همراه',
      required: true,
      type: 'phone',
      synonyms: [
        'mobile',
        'mobile number',
        'phone',
        'cell',
        'telephone',
        'همراه',
        'موبایل',
        'شماره همراه',
        'تلفن همراه',
        'تلفن',
      ],
    },
    {
      key: 'email',
      labelFa: 'رایانامه',
      required: false,
      type: 'email',
      synonyms: ['email', 'e-mail', 'رایانامه', 'ایمیل'],
    },
    {
      key: 'jobTitle',
      labelFa: 'عنوان شغلی',
      required: true,
      type: 'text',
      synonyms: [
        'jobTitle',
        'job title',
        'position',
        'title',
        'عنوان شغلی',
        'سمت',
        'شغل',
        'پست',
      ],
    },
    {
      key: 'department',
      labelFa: 'واحد سازمانی',
      required: true,
      type: 'text',
      synonyms: [
        'department',
        'dept',
        'unit',
        'واحد',
        'واحد سازمانی',
        'دپارتمان',
        'بخش',
      ],
    },
    {
      key: 'maritalStatus',
      labelFa: 'وضعیت تأهل',
      required: false,
      type: 'enum',
      enumValues: Object.values(MaritalStatus),
      enumAliases: MARITAL_STATUS_ALIASES,
      synonyms: [
        'maritalStatus',
        'marital status',
        'وضعیت تأهل',
        'وضعیت تاهل',
        'تأهل',
      ],
    },
    {
      key: 'dependants',
      labelFa: 'تعداد فرزندان',
      required: false,
      type: 'number',
      synonyms: [
        'dependants',
        'dependents',
        'children count',
        'تعداد فرزندان',
        'فرزندان',
      ],
    },
    {
      key: 'hireDate',
      labelFa: 'تاریخ استخدام',
      required: false,
      type: 'date',
      synonyms: [
        'hireDate',
        'hire date',
        'start date',
        'employment date',
        'تاریخ استخدام',
        'تاریخ شروع همکاری',
      ],
    },
    {
      key: 'bankAccountNumber',
      labelFa: 'شماره حساب بانکی',
      required: false,
      type: 'text',
      synonyms: [
        'bankAccountNumber',
        'bank account',
        'account number',
        'شماره حساب',
        'حساب بانکی',
        'شبا',
      ],
    },
  ];

  constructor(private readonly hrService: HrService) {}

  duplicateKeys(record: NormalisedRecord): string[] {
    const nationalId = record.values.nationalId;
    if (typeof nationalId === 'string' && nationalId.trim()) {
      return [`national_id:${nationalId.trim()}`];
    }
    return [];
  }

  async findExistingDuplicateKeys(
    tenantId: string,
    keys: string[],
  ): Promise<string[]> {
    const nationalIds = keys
      .filter((key) => key.startsWith('national_id:'))
      .map((key) => key.slice('national_id:'.length));
    const found = await this.hrService.findExistingNationalIds(
      tenantId,
      nationalIds,
    );
    return found.map((id) => `national_id:${id}`);
  }

  async commit(
    tenantId: string,
    records: NormalisedRecord[],
  ): Promise<AdapterCommitResult> {
    const inserted: CommitRowResult[] = [];
    const failed = [];

    for (const record of records) {
      try {
        const ids = await this.hrService.importEmployees(tenantId, [
          this.toInput(record),
        ]);
        inserted.push({ rowNumber: record.rowNumber, ownerId: ids[0] });
      } catch (error) {
        failed.push({
          rowNumber: record.rowNumber,
          message: this.errorMessage(error, 'درج کارمند ناموفق بود.'),
        });
      }
    }

    return { inserted, failed };
  }

  async undo(tenantId: string, ownerIds: number[]): Promise<UndoOutcome> {
    const { removed, refused } = await this.hrService.removeImportedEmployees(
      tenantId,
      ownerIds,
    );
    return {
      removed,
      refused: refused.map((ownerId) => ({
        ownerId,
        message: 'این کارمند قرارداد یا فیش حقوقی دارد و قابل حذف نیست.',
      })),
    };
  }

  private toInput(record: NormalisedRecord): HrImportEmployeeInput {
    const values = record.values;
    const input: HrImportEmployeeInput = {
      firstName: String(values.firstName ?? '').trim(),
      lastName: String(values.lastName ?? '').trim(),
      nationalId: String(values.nationalId ?? '').trim(),
      mobile: String(values.mobile ?? '').trim(),
      jobTitle: String(values.jobTitle ?? '').trim(),
      department: String(values.department ?? '').trim(),
    };

    if (values.employeeNumber) {
      input.employeeNumber = String(values.employeeNumber).trim();
    }
    if (values.fatherName) {
      input.fatherName = String(values.fatherName).trim();
    }
    if (typeof values.birthDate === 'string') {
      input.birthDate = values.birthDate;
    }
    if (typeof values.gender === 'string') {
      input.gender = values.gender as Gender;
    }
    if (values.email) {
      input.email = String(values.email).trim();
    }
    if (typeof values.maritalStatus === 'string') {
      input.maritalStatus = values.maritalStatus as MaritalStatus;
    }
    if (typeof values.dependants === 'number') {
      input.dependants = values.dependants;
    }
    if (typeof values.hireDate === 'string') {
      input.hireDate = values.hireDate;
    }
    if (values.bankAccountNumber) {
      input.bankAccountNumber = String(values.bankAccountNumber).trim();
    }

    return input;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }
}
