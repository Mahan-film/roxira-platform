import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_ROLE_ACCOUNTS,
  isPostingRole,
  POSTING_ROLE_KEYS,
  POSTING_ROLES,
  type PostingRole,
} from './posting-roles';
import { PostingRuleError } from '../domain/posting-error';

describe('isPostingRole', () => {
  it('accepts every declared posting role', () => {
    for (const role of POSTING_ROLE_KEYS) {
      expect(isPostingRole(role)).toBe(true);
    }
  });

  it('rejects unknown names', () => {
    expect(isPostingRole('nope')).toBe(false);
    expect(isPostingRole('Receivable')).toBe(false);
    expect(isPostingRole('')).toBe(false);
  });

  it('rejects inherited Object properties', () => {
    expect(isPostingRole('toString')).toBe(false);
    expect(isPostingRole('constructor')).toBe(false);
    expect(isPostingRole('hasOwnProperty')).toBe(false);
  });

  it('narrows the type to PostingRole for a known role', () => {
    const value: string = 'bank';
    if (isPostingRole(value)) {
      const role: PostingRole = value;
      expect(POSTING_ROLES[role].label).toBe('بانک');
    } else {
      throw new Error('expected bank to be a posting role');
    }
  });
});

describe('POSTING_ROLE_KEYS', () => {
  it('matches the keys of POSTING_ROLES exactly', () => {
    expect([...POSTING_ROLE_KEYS].sort()).toEqual(Object.keys(POSTING_ROLES).sort());
  });

  it('has no duplicate entries', () => {
    expect(new Set(POSTING_ROLE_KEYS).size).toBe(POSTING_ROLE_KEYS.length);
  });
});

describe('DEFAULT_ROLE_ACCOUNTS', () => {
  it('keys every default to a real posting role', () => {
    for (const key of Object.keys(DEFAULT_ROLE_ACCOUNTS)) {
      expect(isPostingRole(key)).toBe(true);
      expect(POSTING_ROLE_KEYS).toContain(key);
    }
  });

  it('gives every value as a 3-6 digit account code string', () => {
    for (const code of Object.values(DEFAULT_ROLE_ACCOUNTS)) {
      expect(typeof code).toBe('string');
      expect(code).toMatch(/^\d{3,6}$/);
    }
  });
});

describe('PostingRuleError', () => {
  it('is a BadRequestException carrying the code and Persian message', () => {
    const error = new PostingRuleError('UNMAPPED_ROLE', 'حسابی تعیین نشده');
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.code).toBe('UNMAPPED_ROLE');
    expect(error.message).toBe('حسابی تعیین نشده');
    expect(error.getStatus()).toBe(400);
  });

  it('exposes the structured response body', () => {
    const error = new PostingRuleError('UNBALANCED', 'سند تراز نیست');
    expect(error.getResponse()).toEqual({
      statusCode: 400,
      error: 'PostingRuleError',
      code: 'UNBALANCED',
      message: 'سند تراز نیست',
    });
  });
});
