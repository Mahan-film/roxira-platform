
describe('parseOptionalId', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseOptionalId } = require('./hr.controller');
  it.each([
    [undefined, undefined],
    ['', undefined],
    ['undefined', undefined],
    ['12', 12],
    ['۱۲', 12],
    ['١٢', 12],
  ])('%p -> %p', (raw, expected) => {
    expect(parseOptionalId(raw)).toBe(expected);
  });
  it('rejects non-numeric ids', () => {
    expect(() => parseOptionalId('abc')).toThrow();
  });
});
