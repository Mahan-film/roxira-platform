import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { TaxTransmissionMode } from '../enums/tax-transmission.enum';
import { DirectAdapter } from './direct.adapter';
import { TaxTransmissionAdapter } from './tax-transmission.adapter';

/** Optional multi-provider token for real TSP adapters (none exist yet; their APIs are private). */
export const TSP_ADAPTERS = Symbol('TSP_ADAPTERS');

/** Picks the adapter for a profile's mode. Unknown or unimplemented modes fail closed. */
@Injectable()
export class TaxTransmissionAdapterFactory {
  private readonly adapters: TaxTransmissionAdapter[];

  constructor(direct: DirectAdapter, @Optional() @Inject(TSP_ADAPTERS) tsp?: TaxTransmissionAdapter[]) {
    this.adapters = [direct, ...(tsp ?? [])];
  }

  forMode(mode: TaxTransmissionMode): TaxTransmissionAdapter {
    const adapter = this.adapters.find((a) => a.modes.includes(mode));
    if (!adapter) {
      throw new ServiceUnavailableException(`No tax transmission adapter is available for mode ${mode}.`);
    }
    return adapter;
  }
}
