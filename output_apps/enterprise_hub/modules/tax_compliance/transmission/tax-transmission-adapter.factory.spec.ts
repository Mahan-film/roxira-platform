import { ServiceUnavailableException } from '@nestjs/common';
import { TaxTransmissionMode } from '../enums/tax-transmission.enum';
import { FakeTspAdapter } from '../testing/fake-tsp.adapter';
import { DirectAdapter } from './direct.adapter';
import { TaxTransmissionAdapterFactory } from './tax-transmission-adapter.factory';

describe('TaxTransmissionAdapterFactory', () => {
  const direct = { modes: [TaxTransmissionMode.DIRECT] } as unknown as DirectAdapter;
  const fake = new FakeTspAdapter();

  it('picks the direct adapter for direct mode', () => {
    expect(new TaxTransmissionAdapterFactory(direct, [fake]).forMode(TaxTransmissionMode.DIRECT)).toBe(direct);
  });

  it('picks the TSP adapter for both tsp modes', () => {
    const factory = new TaxTransmissionAdapterFactory(direct, [fake]);
    expect(factory.forMode(TaxTransmissionMode.TSP_TAXPAYER_KEY)).toBe(fake);
    expect(factory.forMode(TaxTransmissionMode.TSP_TSP_KEY)).toBe(fake);
  });

  it('fails closed when no adapter is registered for a TSP mode', () => {
    const factory = new TaxTransmissionAdapterFactory(direct);
    expect(() => factory.forMode(TaxTransmissionMode.TSP_TSP_KEY)).toThrow(ServiceUnavailableException);
  });
});
