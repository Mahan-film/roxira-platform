/** Lets test doubles written with jest.fn() (e.g. FakeRedis) run outside Jest, in the dev harness. */
(globalThis as unknown as { jest: { fn: <T>(impl: T) => T } }).jest = { fn: (impl) => impl };
