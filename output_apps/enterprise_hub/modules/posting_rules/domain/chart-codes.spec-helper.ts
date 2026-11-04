import { AccountLevel } from '../../accounting/enums/accounting.enum';
import { CHART_TEMPLATES } from '../../accounting/constants/iran-chart-template';

/** Test helper: account codes of the Iran trading chart that accept postings. */
export const ChartTemplates = {
  postingCodes(): Set<string> {
    const template = CHART_TEMPLATES.find((t) => t.key === 'iran-trading')!;
    return new Set(template.accounts.filter((a) => a.level === AccountLevel.MOEIN || a.level === AccountLevel.TAFSILI).map((a) => a.code));
  },
};
