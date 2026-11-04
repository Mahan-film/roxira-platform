import { Injectable, NotFoundException } from '@nestjs/common';
import { Currency } from '../../currency/enums/currency.enum';
import { CHART_TEMPLATES } from '../constants/iran-chart-template';
import {
  ApplyChartTemplateResponseDto,
  ChartTemplateResponseDto,
} from '../dto/fiscal-year.dto';
import { AccountLevel } from '../enums/accounting.enum';
import { AccountingRepository } from '../repositories/accounting.repository';

/** The standard Iranian charts a company can start from. */
@Injectable()
export class ChartTemplateService {
  constructor(private readonly accountingRepository: AccountingRepository) {}

  list(): ChartTemplateResponseDto[] {
    return CHART_TEMPLATES.map(({ key, name, description, accounts }) => ({
      key,
      name,
      description,
      accountCount: accounts.length,
    }));
  }

  /**
   * Additive and repeatable: missing accounts are added, and accounts sharing a template code keep
   * their name, type and balance but gain a level and a statement line. Header levels (GROUP, KOL)
   * only land on accounts the template creates, because an existing account may hold postings.
   */
  async apply(tenantId: string, key: string): Promise<ApplyChartTemplateResponseDto> {
    const template = CHART_TEMPLATES.find((candidate) => candidate.key === key);
    if (!template) {
      throw new NotFoundException(`قالب سرفصل ${key} یافت نشد.`);
    }
    return this.accountingRepository.transaction(tenantId, async (manager) => {
      const existing = new Map(
        (await this.accountingRepository.findAllAccounts(tenantId, manager)).map((account) => [
          account.code,
          account,
        ]),
      );
      const missing = template.accounts.filter((account) => !existing.has(account.code));
      await this.accountingRepository.insertMissingAccounts(
        tenantId,
        missing.map((account) => ({ ...account, currency: Currency.IRR, balance: '0' })),
        manager,
      );
      let classified = 0;
      for (const account of template.accounts) {
        const current = existing.get(account.code);
        const isHeader = account.level === AccountLevel.GROUP || account.level === AccountLevel.KOL;
        if (!current || isHeader || current.level) {
          continue;
        }
        await this.accountingRepository.updateAccountMetadata(
          tenantId,
          account.code,
          {
            level: account.level,
            parentCode: account.parentCode,
            reportLine: current.reportLine ?? account.reportLine,
          },
          manager,
        );
        classified += 1;
      }
      return { added: missing.length, classified };
    });
  }
}
