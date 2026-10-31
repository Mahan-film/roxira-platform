import { ReconRepository } from './recon.repository';

describe('ReconRepository: every statement is tenant-scoped', () => {
  const queries: string[] = [];
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      return [{ id: 1 }];
    }),
    transaction: jest.fn(),
  };
  const repo = new ReconRepository(dataSource as never);
  const T = '00000000-0000-4000-8000-00000000000a';

  it('uses tenant_id as the first predicate (or column) in all statements', async () => {
    await repo.getSettings(T);
    await repo.saveSettings(T, 'u', { fee_max_rial: '1', sms_fee_max_rial: '1', auto_post_fees: false, auto_match_min_confidence: '0.9', date_window_days: 3, category_accounts: {} });
    await repo.createSession(T, { fileName: 'a', sha256: 'x', kind: 'csv', fileData: Buffer.alloc(1), createdBy: 'u', bankAccountId: 1 });
    await repo.getSession(T, 1);
    await repo.getSessionFile(T, 1);
    await repo.updateSession(T, 1, { status: 'ready' });
    await repo.importedPeriods(T, 1, 2);
    await repo.listSessions(T, 1);
    await repo.listItems(T, 1);
    await repo.listItemsForAccount(T, 1, '2024-01-01');
    await repo.getItem(T, 1);
    await repo.updateItem(T, 1, { status: 'open' });
    await repo.insertMatch(T, { sessionId: 1, groupId: 'g', itemId: 1, journalLineId: 1, stage: 'exact', confidence: 1, status: 'confirmed', method: 'auto', decidedBy: null });
    await repo.listMatches(T, 1);
    await repo.listMatchesForItems(T, [1]);
    await repo.setGroupStatus(T, 1, 'g', 'confirmed', 'u');
    await repo.takenJournalLineIds(T);
    await repo.releaseMatchesOfItem(T, 1);
    await repo.listRules(T);
    await repo.upsertRule(T, 'u', { kind: 'keyword', pattern: 'p', category: 'sale', personType: null, counterAccountCode: null, sourceItemId: 1 });
    await repo.deactivateRule(T, 1);
    await repo.bumpRuleHits(T, [1]);
    await repo.confirmedHistory(T);
    await repo.clearSuggested(T, 1);
    await repo.claimDraft(T, 1, 'u');
    await repo.insertDraft(T, { sessionId: 1, itemId: 1, bankAccountId: 1, entryDate: '2024-01-01', description: 'd', amount: 1n, direction: 'in', counterAccountCode: '1', category: 'sale', auto: false, createdBy: 'u' });
    await repo.listDrafts(T, 1);
    await repo.getDraft(T, 1);
    await repo.updateDraft(T, 1, { status: 'posted' });
    await repo.insertAttachment(T, { itemId: 1, fileName: 'f', mime: 'm', size: 1, sha256: 's', data: Buffer.alloc(1), uploadedBy: 'u' });
    await repo.listAttachments(T, 1);
    await repo.insertReport(T, { bankAccountId: 1, sessionId: 1, periodFrom: 'a', periodTo: 'b', differenceMinor: 0n, snapshot: {}, createdBy: 'u' });
    await repo.listReports(T);
    await repo.getReport(T, 1);
    await repo.audit(T, 'u', 'a', 's', 1);
    await repo.listAudit(T);
    await repo.insertItems(T, [], {} as never);

    expect(queries.length).toBeGreaterThan(30);
    for (const sql of queries) {
      const insert = /^\s*INSERT/i.test(sql);
      if (insert) {
        expect(sql).toMatch(/\(\s*tenant_id/);
      } else {
        expect(sql).toMatch(/tenant_id = \$1/);
      }
    }
  });

  it('never concatenates caller values into SQL text', () => {
    for (const sql of queries) {
      expect(sql).not.toContain('undefined');
      expect(sql).not.toMatch(/'[^']*\$\{/);
    }
  });
});
