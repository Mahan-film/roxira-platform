/** Minimal in-memory stand-in for the ioredis calls the Auth module makes (tests only). */
export class FakeRedis {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);

  set = jest.fn(async (key: string, value: string, ...args: unknown[]) => {
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    const exIdx = args.indexOf('EX');
    this.ttls.set(key, exIdx >= 0 ? Number(args[exIdx + 1]) : -1);
    return 'OK';
  });

  del = jest.fn(async (...keys: string[]) =>
    keys.reduce((n, key) => {
      this.ttls.delete(key);
      return n + (this.store.delete(key) ? 1 : 0);
    }, 0),
  );

  incr = jest.fn(async (key: string) => {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  });

  expire = jest.fn(async (key: string, seconds: number) => {
    this.ttls.set(key, seconds);
    return 1;
  });

  ttl = jest.fn(async (key: string) =>
    this.store.has(key) ? (this.ttls.get(key) ?? -1) : -2,
  );

  /** Emulates the INCR+EXPIRE Lua counter script. */
  eval = jest.fn(async (_script: string, _n: number, key: string, window: number) => {
    const next = await this.incr(key);
    if (next === 1 || (this.ttls.get(key) ?? -1) < 0) this.ttls.set(key, Number(window));
    return next;
  });
}
