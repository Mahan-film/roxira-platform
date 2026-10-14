import {
  buildFallbackMapping,
  normalizeHeader,
} from './lead-field-synonyms';

describe('buildFallbackMapping', () => {
  it('maps Persian headers to CRM lead fields', () => {
    const mapping = buildFallbackMapping([
      'نام و نام خانوادگی',
      'موبایل',
      'ایمیل',
      'شرکت',
      'توضیحات',
    ]);

    expect(mapping).toEqual({
      'نام و نام خانوادگی': 'fullName',
      موبایل: 'phone',
      ایمیل: 'email',
      شرکت: 'company',
      توضیحات: 'notes',
    });
  });

  it('maps English headers case-insensitively', () => {
    const mapping = buildFallbackMapping([
      'Full Name',
      'E-mail',
      'Phone Number',
      'Company',
      'Notes',
    ]);

    expect(mapping).toEqual({
      'Full Name': 'fullName',
      'E-mail': 'email',
      'Phone Number': 'phone',
      Company: 'company',
      Notes: 'notes',
    });
  });

  it('ignores unknown columns and keeps only the first match per field', () => {
    const mapping = buildFallbackMapping([
      'کد مشتری',
      'تلفن',
      'شماره همراه',
      'نام',
    ]);

    expect(mapping).toEqual({
      تلفن: 'phone',
      نام: 'fullName',
    });
  });

  it('normalizes zero-width non-joiner and separators', () => {
    expect(normalizeHeader('\u0646\u0627\u0645\u200c\u0648\u200c\u0646\u0627\u0645')).toBe(
      '\u0646\u0627\u0645\u0648\u0646\u0627\u0645',
    );
    expect(normalizeHeader('phone_number')).toBe('phone number');
  });
});
