import { EntityRegistryService } from './entity-registry.service';
import { EntityImportAdapter } from './import-registry.types';

const ADAPTER: EntityImportAdapter = {
  key: 'hr-employees',
  labelFa: 'کارمندان',
  fields: [
    {
      key: 'nationalId',
      labelFa: 'کد ملی',
      required: true,
      type: 'national_id',
      synonyms: ['کد ملی'],
    },
    {
      key: 'gender',
      labelFa: 'جنسیت',
      required: false,
      type: 'enum',
      enumValues: ['MALE', 'FEMALE'],
      enumAliases: { مرد: 'MALE' },
      synonyms: ['جنسیت'],
    },
  ],
  duplicateKeys: () => [],
  findExistingDuplicateKeys: async () => [],
  commit: async () => ({ inserted: [], failed: [] }),
  undo: async () => ({ removed: 0, refused: [] }),
};

describe('EntityRegistryService', () => {
  const service = new EntityRegistryService([ADAPTER]);

  it('lists registered keys', () => {
    expect(service.keys()).toEqual(['hr-employees']);
  });

  it('gets an adapter by key', () => {
    expect(service.get('hr-employees')).toBe(ADAPTER);
    expect(service.get('missing')).toBeNull();
  });

  it('describes fields without synonyms and with enum values', () => {
    const descriptors = service.descriptors();
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0].key).toBe('hr-employees');
    expect(descriptors[0].fields[0]).toEqual({
      key: 'nationalId',
      labelFa: 'کد ملی',
      required: true,
      type: 'national_id',
    });
    expect(descriptors[0].fields[1].enumValues).toEqual(['MALE', 'FEMALE']);
  });
});
