import { createHash } from 'crypto';
import { isBreachedPassword } from './breach-check.util';

const sha1 = (v: string) => createHash('sha1').update(v).digest('hex').toUpperCase();
const reply = (body: string, ok = true) => (async () => ({ ok, text: async () => body })) as unknown as typeof fetch;

describe('isBreachedPassword', () => {
  it('is off unless PASSWORD_BREACH_CHECK=1 (no network call)', async () => {
    const f = jest.fn() as unknown as typeof fetch;
    await expect(isBreachedPassword('password', {}, f)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('sends only the 5-character hash prefix and detects a hit', async () => {
    const h = sha1('hunter2-hunter2');
    const f = jest.fn(reply(`${h.slice(5)}:42\nAAAA:1`)) as unknown as typeof fetch;
    await expect(isBreachedPassword('hunter2-hunter2', { PASSWORD_BREACH_CHECK: '1' }, f)).resolves.toBe(true);
    const url = (f as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`);
    expect(url).not.toContain(h.slice(5));
  });

  it('ignores padding rows (count 0) and misses', async () => {
    const h = sha1('fresh-unique-passphrase');
    await expect(isBreachedPassword('fresh-unique-passphrase', { PASSWORD_BREACH_CHECK: '1' }, reply(`${h.slice(5)}:0\nBBBB:9`))).resolves.toBe(false);
  });

  it('fails open on network errors and bad responses', async () => {
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(isBreachedPassword('x'.repeat(12), { PASSWORD_BREACH_CHECK: '1' }, boom)).resolves.toBe(false);
    await expect(isBreachedPassword('x'.repeat(12), { PASSWORD_BREACH_CHECK: '1' }, reply('', false))).resolves.toBe(false);
  });
});
