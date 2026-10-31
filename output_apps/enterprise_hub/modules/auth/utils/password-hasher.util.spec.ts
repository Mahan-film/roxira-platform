import { SCRYPT_PARAMS } from '../constants/password-auth.constants';
import { hashPassword, needsRehash, verifyPassword } from './password-hasher.util';

describe('password hasher (scrypt)', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith(`scrypt$${SCRYPT_PARAMS.N}$`)).toBe(true);
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', hash)).resolves.toBe(false);
  });

  it('salts every hash differently and never stores the password', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password-1'), hashPassword('same-password-1')]);
    expect(a).not.toEqual(b);
    expect(a).not.toContain('same-password-1');
  });

  it('treats Unicode-equivalent passwords as equal (NFKC)', async () => {
    const hash = await hashPassword('café-password');
    await expect(verifyPassword('café-password', hash)).resolves.toBe(true);
  });

  it('returns false (not an exception) for malformed hashes', async () => {
    for (const bad of ['', 'plaintext', 'scrypt$1$2', 'bcrypt$a$b$c$d$e', 'scrypt$x$8$1$AA==$AA==']) {
      await expect(verifyPassword('whatever-123', bad)).resolves.toBe(false);
    }
  });

  it('flags weaker stored parameters for rehash on next login', async () => {
    expect(needsRehash(await hashPassword('another-password-1'))).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$AAAA$AAAA')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});
