import { Injectable } from '@nestjs/common';
import {
  exportBuchungsstapel,
  exportDebitorenKreditoren,
  exportSachkontenbeschriftungen,
  validateDatevExtfFile,
} from './extf700';
import type {
  DatevAccountLabelRow,
  DatevExportResult,
  DatevHeaderConfig,
  DatevPartyRow,
  DatevPostingRow,
} from './datev-extf.types';

@Injectable()
export class DatevExtfService {
  exportPostings(
    rows: readonly DatevPostingRow[],
    config: DatevHeaderConfig,
  ): DatevExportResult {
    return exportBuchungsstapel(rows, config);
  }

  exportParties(
    rows: readonly DatevPartyRow[],
    config: DatevHeaderConfig,
  ): DatevExportResult {
    return exportDebitorenKreditoren(rows, config);
  }

  exportAccountLabels(
    rows: readonly DatevAccountLabelRow[],
    config: DatevHeaderConfig,
  ): DatevExportResult {
    return exportSachkontenbeschriftungen(rows, config);
  }

  validateFile = validateDatevExtfFile;
}
