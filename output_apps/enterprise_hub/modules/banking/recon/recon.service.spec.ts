import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PostingRulesService } from '../../posting_rules/services/posting-rules.service';
import { FakeLedger, FakePostingRulesRepository, FakeReconRepository } from './__fixtures__/fakes';
import { gregorian, OPENING, statementCsv, TXNS } from './__fixtures__/statements';
import { ReconService } from './recon.service';
import { readGrid } from './parse/statement-parser';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ADMIN = 'user-a';

const mellatAccount = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'ملت جاری',
  bankCode: 'mellat',
  accountNumber: '0102345678001',
  iban: null,
  ledgerAccountId: 10,
  ledgerAccountCode: '1010',
  openingBalance: OPENING,
  ...over,
});

function setup() {
  const repo = new FakeReconRepository();
  const ledger = new FakeLedger();
  ledger.addBank(A, mellatAccount());
  const postingRepo = new FakePostingRulesRepository();
  const postingRules = new PostingRulesService(postingRepo as never, ledger.accounting as never);
  const service = new ReconService(repo as never, ledger.banking as never, ledger.accounting as never, postingRules);
  return { repo, ledger, service, postingRepo, postingRules };
}

function seedBook(ledger: FakeLedger, tenant = A) {
  ledger.addLine(tenant, { date: gregorian('1403/07/01'), debit: 50_000_000, description: 'فروش به آلفا' });
  ledger.addLine(tenant, { date: gregorian('1403/07/03'), credit: 12_000_000, description: 'خرید از بتا' }); // bank: 07/02, +1 day
  ledger.addLine(tenant, { date: gregorian('1403/07/05'), credit: 30_000_000, description: 'حقوق' });
  ledger.addLine(tenant, { date: gregorian('1403/06/20'), credit: 40_000_000, description: 'چک شماره 123456 به تامین‌کننده' });
  ledger.addLine(tenant, { date: gregorian('1403/07/14'), debit: 7_000_000, description: 'دریافت در راه' });
}

const upload = (service: ReconService, tenant = A, buffer = statementCsv('mellat'), name = 'mellat.csv') =>
  service.uploadStatement(tenant, ADMIN, { buffer, originalname: name, mimetype: 'text/csv' });

describe('upload and prerequisites', () => {
  it('a known account and a clean statement are ready to commit', async () => {
    const { service } = setup();
    const view = await upload(service);
    expect(view.status).toBe('ready');
    expect(view.bankAccountId).toBe(1);
    expect(view.rowCount).toBe(TXNS.length);
    expect(view.checks.every((c) => ['ok', 'warn'].includes(c.severity))).toBe(true);
  });

  it('commit refuses while a question is unanswered', async () => {
    const { service, ledger } = setup();
    ledger.bankAccounts.set(A, [mellatAccount({ bankCode: 'melli' })]);
    const view = await upload(service);
    expect(view.status).toBe('needs_confirmation');
    await expect(service.commit(A, ADMIN, view.id)).rejects.toBeInstanceOf(ConflictException);
    const answered = await service.answerCheck(A, ADMIN, view.id, 'bank_match', 'confirm');
    expect(answered.status).toBe('ready');
  });

  it('answers must be one of the offered choices', async () => {
    const { service, ledger } = setup();
    ledger.bankAccounts.set(A, [mellatAccount({ bankCode: 'melli' })]);
    const view = await upload(service);
    await expect(service.answerCheck(A, ADMIN, view.id, 'bank_match', 'drop-table')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.answerCheck(A, ADMIN, view.id, 'running_balance', 'continue')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an unknown account leads to a guided create step and then proceeds', async () => {
    const { service, ledger } = setup();
    ledger.bankAccounts.set(A, []);
    const view = await upload(service);
    expect(view.status).toBe('needs_confirmation');
    expect(view.offerCreateAccount).toBe(true);
    const created = await service.createAccountFromSession(A, ADMIN, view.id, { name: 'ملت جدید', ledgerAccountId: 10 });
    expect(created.bankAccountId).not.toBeNull();
    expect(created.status).toBe('ready');
  });

  it('an unknown layout needs mapping, and the mapping then makes it ready', async () => {
    const { service } = setup();
    const view = await upload(service, A, statementCsv('sepah'), 'sepah.csv');
    expect(view.status).toBe('needs_mapping');
    expect(view.mapping?.headers).toContain('مبلغ بدهکار (ریال)');
    await expect(service.submitMapping(A, ADMIN, view.id, { description: 1 })).rejects.toBeInstanceOf(BadRequestException);
    const mapped = await service.submitMapping(A, ADMIN, view.id, { date: 0, description: 1, reference: 2, withdrawal: 3, deposit: 4, balance: 5 });
    expect(mapped.status).not.toBe('needs_mapping');
    expect(mapped.rowCount).toBe(TXNS.length);
  });

  it('rejects unreadable uploads with a Persian error', async () => {
    const { service } = setup();
    await expect(service.uploadStatement(A, ADMIN, { buffer: Buffer.alloc(0), originalname: 'a.csv', mimetype: '' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('commit: matching, classification, drafts', () => {
  async function committed(options: { autoPost?: boolean } = {}) {
    const ctx = setup();
    seedBook(ctx.ledger);
    if (options.autoPost) {
      await ctx.service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: '5090', sms_fee: '5090' }, autoPostFees: true });
    } else {
      await ctx.service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: '5090', sms_fee: '5090', payroll: '5010' } });
    }
    const view = await upload(ctx.service);
    const review = await ctx.service.commit(A, ADMIN, view.id);
    return { ...ctx, sessionId: view.id, review };
  }

  it('matches what the ledger has, drafts the fees, and asks nothing it can decide', async () => {
    const { review } = await committed();
    // sale (exact), purchase (1 day), payroll (exact), cheque (123456 text) are matched.
    expect(review.counts.matched).toBe(4);
    const unmatchedDesc = (review.unmatched as Array<{ description: string }>).map((u) => u.description);
    expect(unmatchedDesc.some((d) => d.includes('کارمزد'))).toBe(true);
    expect(review.drafts.map((d) => d.category).sort()).toEqual(['bank_fee', 'sms_fee']);
    expect(review.drafts.every((d) => d.status === 'draft' && !d.auto)).toBe(true);
  });

  it('fee drafts are never auto-posted unless a tenant admin enabled it', async () => {
    const { ledger, review } = await committed();
    expect(ledger.entries).toHaveLength(0);
    expect(review.drafts.every((d) => d.status === 'draft')).toBe(true);
  });

  it('with auto-post on, only small fees are posted; other drafts still wait for approval', async () => {
    const { ledger, review, repo } = await committed({ autoPost: true });
    const posted = review.drafts.filter((d) => d.status === 'posted');
    expect(posted.map((d) => d.category).sort()).toEqual(['bank_fee', 'sms_fee']);
    expect(ledger.entries).toHaveLength(2);
    expect(repo.auditLog.some((a) => a.action === 'draft.autopost')).toBe(true);
  });

  it('enabling auto-post needs a fee expense account', async () => {
    const { service } = setup();
    await expect(service.updateSettings(A, ADMIN, { autoPostFees: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: 'NOPE' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateSettings(A, ADMIN, { categoryAccounts: { galaxy: '5090' } })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an unresolved item gets one question; answering creates a reusable rule and a draft', async () => {
    const { service, review, repo } = await committed();
    const loan = (review.unmatched as Array<{ id: number; description: string }>).find((u) => u.description.includes('قسط'))!;
    const answered = await service.answerQuestion(A, ADMIN, loan.id, { choiceId: 'loan', counterAccountCode: '2030' });
    expect(answered.draft).toMatchObject({ category: 'loan', counterAccountCode: '2030', status: 'draft' });
    const partner = (review.unmatched as Array<{ id: number; description: string }>).find((u) => u.description.includes('جاری شریک'))!;
    const second = await service.answerQuestion(A, ADMIN, partner.id, { choiceId: 'partner_current', counterAccountCode: '3030' });
    expect(second.draft).not.toBeNull();
    expect(repo.rules.some((r) => r.kind === 'counterparty' && r.category === 'partner_current')).toBe(true);
    expect(repo.auditLog.filter((a) => a.action === 'question.answer')).toHaveLength(2);
  });

  it('the learned rule is used on the next statement for the same counterparty', async () => {
    const { service, repo } = setup();
    await service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: '5090' } });
    const neutral = { ...TXNS[5], description: 'واریز از علی رضایی بابت تسویه' };
    const first = await upload(service, A, statementCsv('mellat', { txns: [neutral, TXNS[6]], openingBalance: OPENING }), 'a.csv');
    const review = await service.commit(A, ADMIN, first.id);
    const row = (review.unmatched as Array<{ id: number; description: string }>).find((u) => u.description.includes('رضایی'))!;
    await service.answerQuestion(A, ADMIN, row.id, { choiceId: 'sale', counterAccountCode: '5010' });
    const nextTxn = { ...TXNS[5], jalali: '1403/08/03', description: 'واریز از علی رضایی بابت چیز دیگر', reference: '800000001' };
    const second = await upload(service, A, statementCsv('mellat', { txns: [nextTxn], openingBalance: OPENING + 20_000_000 - 8_000_000 }), 'b.csv');
    // opening differs from the previous closing in this tiny fixture; accept it explicitly.
    await service.answerCheck(A, ADMIN, second.id, 'opening_continuity', 'accept').catch(() => undefined);
    const secondReview = await service.commit(A, ADMIN, second.id);
    const item = repo.items.find((i) => i.session_id === second.id)!;
    expect(item).toMatchObject({ category: 'sale', classification_source: 'tenant_rule' });
    expect(secondReview.drafts.some((d) => d.category === 'sale' && d.counterAccountCode === '5010')).toBe(true);
  });

  it('an attached document is stored with its hash; unknown types are refused', async () => {
    const { service, repo, review } = await committed();
    const id = (review.unmatched as Array<{ id: number }>)[0].id;
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n');
    const stored = await service.attachDocument(A, ADMIN, id, { buffer: pdf, originalname: 'سند.pdf' });
    expect(stored.sha256).toHaveLength(64);
    expect(repo.attachments).toHaveLength(1);
    await expect(service.attachDocument(A, ADMIN, id, { buffer: Buffer.from([1, 2, 3, 4]), originalname: 'x.exe' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.attachDocument(A, ADMIN, id, { buffer: Buffer.alloc(0), originalname: 'x.pdf' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the same file cannot be committed twice; a second commit call conflicts', async () => {
    const { service, sessionId } = await committed();
    await expect(service.commit(A, ADMIN, sessionId)).rejects.toBeInstanceOf(ConflictException);
    const again = await upload(service);
    expect(again.checks.find((c) => c.code === 'duplicate_file')?.severity).toBe('block');
    await expect(service.commit(A, ADMIN, again.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('journal lines already matched elsewhere (legacy flow) are not offered again', async () => {
    const ctx = setup();
    seedBook(ctx.ledger);
    const sale = ctx.ledger.lines.get(A)![0];
    ctx.repo.legacyTaken.set(A, new Set([sale.id]));
    const view = await upload(ctx.service);
    const review = await ctx.service.commit(A, ADMIN, view.id);
    expect(review.counts.matched).toBe(3);
  });
});

describe('posting: batch approval, period locks, reversal-only correction', () => {
  async function withDrafts() {
    const ctx = setup();
    seedBook(ctx.ledger);
    await ctx.service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: '5090', sms_fee: '5020' } });
    const view = await upload(ctx.service);
    const review = await ctx.service.commit(A, ADMIN, view.id);
    return { ...ctx, sessionId: view.id, drafts: review.drafts };
  }

  it('batch approval posts balanced vouchers with a stable number and links the bank line', async () => {
    const { service, ledger, drafts, repo } = await withDrafts();
    const results = await service.approveDrafts(A, 'approver', drafts.map((d) => d.id));
    expect(results.every((r) => r.status === 'posted')).toBe(true);
    const entry = ledger.entries[0];
    expect(entry.number).toBe(`RCN-${drafts[0].id}`);
    const bankLine = entry.dto.lines.find((l: { accountCode: string }) => l.accountCode === '1010');
    expect(Number(bankLine.credit)).toBe(Number(drafts[0].amountRial)); // fee: money out = credit bank
    expect(repo.matches.filter((m) => m.stage === 'created' && m.status === 'confirmed')).toHaveLength(2);
    // Approving again does nothing.
    const again = await service.approveDrafts(A, 'approver', drafts.map((d) => d.id));
    expect(again.every((r) => r.status === 'skipped')).toBe(true);
    expect(ledger.entries).toHaveLength(2);
  });

  it('posting the same draft again returns the same entry (replayed), not a second voucher', async () => {
    const { service, ledger, repo, drafts } = await withDrafts();
    const [first] = await service.approveDrafts(A, 'approver', [drafts[0].id]);
    expect(first.status).toBe('posted');
    const posted = ledger.entries.length;
    // Reopen the draft (as an operator correcting a matching slip would) and approve it again.
    const row = repo.drafts.find((d) => d.id === drafts[0].id)!;
    row.status = 'draft';
    row.journal_entry_id = null;
    const [replay] = await service.approveDrafts(A, 'approver', [drafts[0].id]);
    expect(replay.status).toBe('posted');
    expect(replay.journalEntryId).toBe(first.journalEntryId);
    expect(ledger.entries).toHaveLength(posted);
  });

  it('a locked period fails that draft with the reason and does not stop the others', async () => {
    const { service, ledger, drafts, repo } = await withDrafts();
    ledger.lockedUntil.set(A, gregorian('1403/07/03'));
    const results = await service.approveDrafts(A, 'approver', drafts.map((d) => d.id));
    expect(results.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(results[0].reason).toContain('قفل');
    expect(ledger.entries).toHaveLength(0);
    expect(repo.drafts.every((d) => d.status === 'failed')).toBe(true);
  });

  it('correction is reversal-only: the draft is reversed, the item reopens, nothing is deleted', async () => {
    const { service, ledger, drafts, repo } = await withDrafts();
    await service.approveDrafts(A, 'approver', [drafts[0].id]);
    const reversed = await service.reverseDraft(A, 'approver', drafts[0].id, 'طرف حساب اشتباه');
    expect(reversed.status).toBe('reversed');
    expect(reversed.reversalEntryId).not.toBeNull();
    expect(ledger.entries).toHaveLength(1); // the original entry is untouched
    expect(repo.items.find((i) => i.id === drafts[0].itemId)!.status).toBe('open');
    await expect(service.reverseDraft(A, 'approver', drafts[0].id, 'again please')).rejects.toBeInstanceOf(NotFoundException);
    // The item can be classified and drafted again.
    const redo = await service.answerQuestion(A, 'approver', drafts[0].itemId, { choiceId: 'bank_fee', counterAccountCode: '5090' });
    expect(redo.draft?.status).toBe('draft');
  });

  it('a posted item cannot be re-answered while its voucher stands', async () => {
    const { service, drafts } = await withDrafts();
    await service.approveDrafts(A, 'approver', [drafts[0].id]);
    await expect(service.answerQuestion(A, 'approver', drafts[0].itemId, { choiceId: 'tax' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('a rejected draft can be drafted again later and is never posted', async () => {
    const { service, ledger, drafts } = await withDrafts();
    await service.rejectDraft(A, 'approver', drafts[0].id);
    const results = await service.approveDrafts(A, 'approver', [drafts[0].id]);
    expect(results[0].status).toBe('skipped');
    expect(ledger.entries).toHaveLength(0);
  });
});

describe('suggested matches and the reconciliation report', () => {
  it('a suggested group needs an explicit accept; accepting clears the item', async () => {
    const ctx = setup();
    // One bank deposit of 70M vs vouchers 50M + 20M (many-to-one).
    ctx.ledger.addLine(A, { date: gregorian('1403/07/01'), debit: 50_000_000 });
    ctx.ledger.addLine(A, { date: gregorian('1403/07/01'), debit: 20_000_000 });
    const txns = [{ ...TXNS[0], deposit: 70_000_000 }];
    const view = await upload(ctx.service, A, statementCsv('mellat', { txns }), 'lump.csv');
    const review = await ctx.service.commit(A, ADMIN, view.id);
    expect(review.counts.matched).toBe(0);
    expect(review.suggested).toHaveLength(1);
    const question = review.questions.find((q) => q.kind === 'confirm_match')!;
    expect(question.groupId).toBeDefined();
    const after = await ctx.service.decideMatch(A, ADMIN, view.id, question.groupId!, true);
    expect(after.counts.matched).toBe(1);
    expect(after.suggested).toHaveLength(0);
  });

  it('rejecting a suggestion leaves the item unmatched', async () => {
    const ctx = setup();
    ctx.ledger.addLine(A, { date: gregorian('1403/07/01'), debit: 50_000_000 });
    ctx.ledger.addLine(A, { date: gregorian('1403/07/01'), debit: 50_000_000 });
    const view = await upload(ctx.service, A, statementCsv('mellat', { txns: [TXNS[0]] }), 'dup.csv');
    const review = await ctx.service.commit(A, ADMIN, view.id);
    expect(review.suggested).toHaveLength(1);
    const after = await ctx.service.decideMatch(A, ADMIN, view.id, review.questions.find((q) => q.groupId)!.groupId!, false);
    expect(after.counts.unmatched).toBe(1);
  });

  it('builds the reconciliation statement, stores history and exports Excel/CSV/HTML', async () => {
    const ctx = setup();
    seedBook(ctx.ledger);
    const view = await upload(ctx.service);
    await ctx.service.commit(A, ADMIN, view.id);
    const { id, report } = (await ctx.service.buildReport(A, ADMIN, view.id)) as { id: number; report: any };
    expect(report.periodFrom).toBe(gregorian('1403/07/01'));
    expect(report.depositsInTransit).toHaveLength(1);
    expect(report.depositsInTransit[0].amount).toBe('700000000.00'.replace('700000000.00', '7000000.00'));
    expect(report.bankOnlyWithdrawals.length).toBeGreaterThanOrEqual(4);
    const history = await ctx.service.listReports(A, 1);
    expect(history).toHaveLength(1);
    const xlsx = await ctx.service.exportReport(A, id, 'xlsx');
    expect(readGrid(xlsx.body, 'r.xlsx').grid.flat().join('|')).toContain('مانده تعدیل‌شده بانک');
    expect((await ctx.service.exportReport(A, id, 'csv')).body.toString()).toContain('صورت مغایرت بانکی');
    expect((await ctx.service.exportReport(A, id, 'html')).contentType).toContain('text/html');
  });

  it('the report needs a committed session', async () => {
    const ctx = setup();
    const view = await upload(ctx.service);
    await expect(ctx.service.buildReport(A, ADMIN, view.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('tenant isolation', () => {
  it('another tenant cannot read, change, approve, report or export anything', async () => {
    const ctx = setup();
    ctx.ledger.addBank(B, mellatAccount({ id: 7, name: 'حساب B' }));
    seedBook(ctx.ledger);
    await ctx.service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: '5090', sms_fee: '5090' } });
    const view = await upload(ctx.service);
    const review = await ctx.service.commit(A, ADMIN, view.id);
    const draft = review.drafts[0];
    const itemId = (review.unmatched as Array<{ id: number }>)[0].id;
    const reportId = (await ctx.service.buildReport(A, ADMIN, view.id) as { id: number }).id;

    await expect(ctx.service.getSession(B, view.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.getReview(B, view.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.commit(B, 'b', view.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.rematch(B, 'b', view.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.answerQuestion(B, 'b', itemId, { choiceId: 'tax' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.attachDocument(B, 'b', itemId, { buffer: Buffer.from('%PDF-1.4'), originalname: 'a.pdf' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.rejectDraft(B, 'b', draft.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.reverseDraft(B, 'b', draft.id, 'no reason')).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.buildReport(B, 'b', view.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.exportReport(B, reportId, 'xlsx')).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.service.decideMatch(B, 'b', view.id, 'x', true)).rejects.toBeInstanceOf(NotFoundException);

    const approved = await ctx.service.approveDrafts(B, 'b', [draft.id]);
    expect(approved[0].status).toBe('skipped');
    expect(await ctx.service.listSessions(B)).toEqual([]);
    expect(await ctx.service.listReports(B)).toEqual([]);
    expect((await ctx.service.listAudit(B)).every((a: { tenant_id: string }) => a.tenant_id === B)).toBe(true);
    expect(await ctx.service.listRules(B)).toEqual([]);
    expect((await ctx.service.getSettings(B)).categoryAccounts).toEqual({});
    await expect(ctx.service.deleteRule(B, 'b', 1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant B cannot use tenant A bank account as the target of an upload', async () => {
    const ctx = setup();
    ctx.ledger.addBank(B, mellatAccount({ id: 7, name: 'حساب B' }));
    await expect(
      ctx.service.uploadStatement(B, 'b', { buffer: statementCsv('mellat'), originalname: 'x.csv', mimetype: 'text/csv' }, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rules learned by one tenant do not classify another tenant\'s statements', async () => {
    const ctx = setup();
    ctx.ledger.addBank(B, mellatAccount({ id: 7, name: 'حساب B' }));
    await ctx.service.updateSettings(A, ADMIN, { categoryAccounts: { bank_fee: '5090' } });
    const neutral = { ...TXNS[5], description: 'واریز از علی رضایی بابت تسویه' };
    const viewA = await upload(ctx.service, A, statementCsv('mellat', { txns: [neutral] }), 'a.csv');
    const reviewA = await ctx.service.commit(A, ADMIN, viewA.id);
    const row = (reviewA.unmatched as Array<{ id: number }>)[0];
    await ctx.service.answerQuestion(A, ADMIN, row.id, { choiceId: 'purchase', counterAccountCode: '5010' });
    const viewB = await upload(ctx.service, B, statementCsv('mellat', { txns: [neutral] }), 'b.csv');
    await ctx.service.commit(B, 'b', viewB.id);
    const itemB = ctx.repo.items.find((i) => i.tenant_id === B)!;
    expect(itemB.classification_source).not.toBe('tenant_rule');
    expect(itemB.category).not.toBe('purchase');
  });
});
