/**
 * In-memory PostingRulesRepository for invoicing specs: a tenant-scoped source ledger with transaction
 * rollback and no tenant mappings, wired into a real PostingRulesService over the spec's accounting
 * fake. Mirrors modules/hr/__fixtures__/fake-posting-rules.ts.
 */
import { AccountingService } from '../../accounting/services/accounting.service';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';

interface SourceRow {
  entryId: number | null;
  entryNumber: string | null;
}

export class FakePostingRepository {
  private sources = new Map<string, SourceRow>();

  private key(t: string, st: string, sid: string, dt: string): string {
    return `${t}/${st}/${sid}/${dt}`;
  }

  async runInTransaction<T>(_tenantId: string, work: (manager: unknown) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.sources);
    try {
      return await work({});
    } catch (error) {
      this.sources = snapshot;
      throw error;
    }
  }

  async listMappings(): Promise<never[]> {
    return [];
  }

  async listAllMappings(): Promise<never[]> {
    return [];
  }

  async findSource(tenantId: string, sourceType: string, sourceId: string, docType: string): Promise<SourceRow | null> {
    return this.sources.get(this.key(tenantId, sourceType, sourceId, docType)) ?? null;
  }

  async claimSource(tenantId: string, sourceType: string, sourceId: string, docType: string): Promise<boolean> {
    const key = this.key(tenantId, sourceType, sourceId, docType);
    if (this.sources.has(key)) return false;
    this.sources.set(key, { entryId: null, entryNumber: null });
    return true;
  }

  async attachEntry(tenantId: string, sourceType: string, sourceId: string, docType: string, entryId: number, entryNumber: string): Promise<void> {
    Object.assign(this.sources.get(this.key(tenantId, sourceType, sourceId, docType))!, { entryId, entryNumber });
  }
}

export function fakePostingRules(accounting: AccountingService): PostingRulesService {
  return new PostingRulesService(new FakePostingRepository() as never, accounting);
}
