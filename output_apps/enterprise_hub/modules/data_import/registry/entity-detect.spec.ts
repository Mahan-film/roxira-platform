import {
  buildEntityFallbackMapping,
  detectEntity,
  scoreEntityHeaders,
} from './entity-detect';
import {
  EntityImportAdapter,
  ImportFieldDefinition,
} from './import-registry.types';

function adapter(
  key: string,
  fields: ImportFieldDefinition[],
): EntityImportAdapter {
  return {
    key,
    labelFa: key,
    fields,
    duplicateKeys: () => [],
    findExistingDuplicateKeys: async () => [],
    commit: async () => ({ inserted: [], failed: [] }),
    undo: async () => ({ removed: 0, refused: [] }),
  };
}

const CRM = adapter('crm-leads', [
  {
    key: 'fullName',
    labelFa: 'نام',
    required: true,
    type: 'text',
    synonyms: ['نام', 'name', 'نام مشتری'],
  },
  {
    key: 'email',
    labelFa: 'ایمیل',
    required: true,
    type: 'email',
    synonyms: ['ایمیل', 'email'],
  },
]);

const HR = adapter('hr-employees', [
  {
    key: 'nationalId',
    labelFa: 'کد ملی',
    required: true,
    type: 'national_id',
    synonyms: ['کد ملی', 'national id'],
  },
  {
    key: 'mobile',
    labelFa: 'موبایل',
    required: true,
    type: 'phone',
    synonyms: ['موبایل', 'mobile'],
  },
]);

describe('scoreEntityHeaders', () => {
  it('counts matching header synonyms', () => {
    expect(scoreEntityHeaders(['نام', 'ایمیل', 'ستون ناشناس'], CRM)).toBe(2);
  });
});

describe('detectEntity', () => {
  it('picks the best matching entity with confidence', () => {
    const result = detectEntity(['نام', 'ایمیل'], [CRM, HR]);
    expect(result.key).toBe('crm-leads');
    expect(result.confidence).toBe(1);
    expect(result.ambiguous).toBe(false);
  });

  it('flags ambiguity when two entities score equally', () => {
    const result = detectEntity(['نام', 'کد ملی'], [CRM, HR]);
    expect(result.ambiguous).toBe(true);
  });

  it('flags ambiguity with zero matches', () => {
    const result = detectEntity(['zzz'], [CRM, HR]);
    expect(result.ambiguous).toBe(true);
    expect(result.confidence).toBe(0);
  });
});

describe('buildEntityFallbackMapping', () => {
  it('maps headers to fields and ignores unknown columns', () => {
    expect(buildEntityFallbackMapping(CRM.fields, ['نام', 'ایمیل', 'ناشناس'])).toEqual(
      { نام: 'fullName', ایمیل: 'email' },
    );
  });
});
