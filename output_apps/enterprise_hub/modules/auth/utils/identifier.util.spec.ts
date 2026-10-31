import {
  isEmail,
  isUsername,
  parseLoginIdentifier,
  passwordPolicyViolation,
} from './identifier.util';

describe('identifier utils', () => {
  it('classifies login identifiers and lowercases them', () => {
    expect(parseLoginIdentifier(' Jane@Example.COM ')).toEqual({ kind: 'email', value: 'jane@example.com' });
    expect(parseLoginIdentifier('Jane.Doe')).toEqual({ kind: 'username', value: 'jane.doe' });
  });

  it('validates usernames and emails', () => {
    expect(isUsername('jane.doe')).toBe(true);
    for (const bad of ['ab', '.jane', 'jane.', 'jane doe', 'jane@doe', 'a'.repeat(33)]) {
      expect(isUsername(bad)).toBe(false);
    }
    expect(isEmail('a@b.co')).toBe(true);
    for (const bad of ['a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'a@.com']) {
      expect(isEmail(bad)).toBe(false);
    }
  });

  it('enforces the password policy', () => {
    expect(passwordPolicyViolation('short')).toMatch(/at least 10/);
    expect(passwordPolicyViolation('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordPolicyViolation('password123')).toMatch(/easy to guess/);
    expect(passwordPolicyViolation('aaaaaaaaaaaa')).toMatch(/easy to guess/);
    expect(passwordPolicyViolation('jane.doe.1234', ['jane.doe.1234'])).toMatch(/must not match/);
    expect(passwordPolicyViolation('janedoejane', ['janedoejane@x.com'])).toMatch(/must not match/);
    expect(passwordPolicyViolation('a-long-unusual-pass')).toBeNull();
  });
});
