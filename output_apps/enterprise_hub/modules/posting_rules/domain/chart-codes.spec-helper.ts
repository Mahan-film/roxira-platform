import { AccountLevel } from '../../accounting/enums/accounting.enum';
import { CHART_TEMPLATES, ChartTemplateAccount } from '../../accounting/constants/iran-chart-template';

/** Test helper: account codes and definitions of the Iran trading chart that accept postings. */
export const ChartTemplates = {
  postingAccounts(): Map<string, ChartTemplateAccount> {
    const template = CHART_TEMPLATES.find((t) => t.key === 'iran-trading')!;
    return new Map(
      template.accounts
        .filter((a) => a.level === AccountLevel.MOEIN || a.level === AccountLevel.TAFSILI)
        .map((a) => [a.code, a] as const),
    );
  },
  postingCodes(): Set<string> {
    return new Set(this.postingAccounts().keys());
  },
};
