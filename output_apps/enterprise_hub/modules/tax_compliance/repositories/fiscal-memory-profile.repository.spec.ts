import { TaxTransmissionEnvironment as E, TaxTransmissionMode as M } from '../enums/tax-transmission.enum';
import { FiscalMemoryProfileValidationError, normalizeProfileInput } from './fiscal-memory-profile.repository';

describe('normalizeProfileInput', () => {
  it('uppercases the memory id and accepts direct without a provider', () => {
    expect(normalizeProfileInput({ memoryId: ' abc123 ', mode: M.DIRECT, environment: E.SANDBOX })).toEqual({
      memoryId: 'ABC123', mode: M.DIRECT, environment: E.SANDBOX, tspProvider: null, active: true,
    });
  });
  it('requires a provider for tsp modes and forbids it for direct', () => {
    expect(() => normalizeProfileInput({ memoryId: 'ABC123', mode: M.TSP_TSP_KEY, environment: E.PRODUCTION })).toThrow(
      FiscalMemoryProfileValidationError,
    );
    expect(() =>
      normalizeProfileInput({ memoryId: 'ABC123', mode: M.DIRECT, environment: E.PRODUCTION, tspProvider: 'x' }),
    ).toThrow(FiscalMemoryProfileValidationError);
    expect(
      normalizeProfileInput({ memoryId: 'ABC123', mode: M.TSP_TAXPAYER_KEY, environment: E.PRODUCTION, tspProvider: 'p' })
        .tspProvider,
    ).toBe('p');
  });
  it('rejects a bad memory id, mode or environment', () => {
    expect(() => normalizeProfileInput({ memoryId: 'ABC', mode: M.DIRECT, environment: E.SANDBOX })).toThrow();
    expect(() => normalizeProfileInput({ memoryId: 'ABC123', mode: 'x' as M, environment: E.SANDBOX })).toThrow();
    expect(() => normalizeProfileInput({ memoryId: 'ABC123', mode: M.DIRECT, environment: 'x' as E })).toThrow();
  });
});
