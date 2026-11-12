import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmTreasurySmsDraftDto } from './dto/treasury-sms.dto';
import { TreasurySmsService } from './services/treasury-sms.service';
import { TreasurySmsRepository } from './repositories/treasury-sms.repository';
import { TreasuryService } from './services/treasury.service';
import {
  TreasurySmsDraftEntity,
  TreasurySmsDraftStatus,
} from './entities/treasury-sms-draft.entity';
import { BankCode } from '../banking/enums/banking.enum';
import { TreasuryDocKind, TreasuryMethod, TreasuryPartyType } from './enums/treasury.enum';
import { TreasurySmsController } from './controllers/treasury-sms.controller';
import { AuthenticatedRequest } from '../auth/guards/jwt-auth.guard';

describe('TreasurySmsService & Controller (T92)', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  let draftsDb: TreasurySmsDraftEntity[] = [];
  let nextId = 1;

  const mockRepo = {
    createDraft: jest.fn(async (tenantId, userId, parsed) => {
      const draft: TreasurySmsDraftEntity = {
        id: `draft-${nextId++}`,
        tenantId,
        userId,
        bank: parsed.bank,
        bankNameFa: parsed.bankNameFa,
        direction: parsed.direction,
        docKind: parsed.docKind,
        amount: parsed.amountDecimal,
        balance: parsed.balanceDecimal ?? null,
        accountTail: parsed.accountTail ?? null,
        cardTail: parsed.cardTail ?? null,
        reference: parsed.reference ?? null,
        dateTime: parsed.dateTime ? new Date(parsed.dateTime) : null,
        rawText: parsed.rawText,
        status: TreasurySmsDraftStatus.DRAFT,
        matchedDocumentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      draftsDb.push(draft);
      return draft;
    }),
    listDrafts: jest.fn(async (tenantId, query) => {
      return draftsDb.filter((d) => {
        if (d.tenantId !== tenantId) return false;
        if (query?.status && d.status !== query.status) return false;
        if (query?.docKind && d.docKind !== query.docKind) return false;
        return true;
      });
    }),
    findDraftById: jest.fn(async (tenantId, id) => {
      return draftsDb.find((d) => d.tenantId === tenantId && d.id === id) ?? null;
    }),
    runInTransaction: jest.fn(async (_tenantId, work) => work({ tx: true })),
    claimDraftForConfirm: jest.fn(async (tenantId, id) => {
      const draft = draftsDb.find((d) => d.tenantId === tenantId && d.id === id);
      if (!draft || draft.status !== TreasurySmsDraftStatus.DRAFT) return false;
      draft.status = TreasurySmsDraftStatus.CONFIRMED;
      return true;
    }),
    setMatchedDocument: jest.fn(async (tenantId, id, docId) => {
      const draft = draftsDb.find((d) => d.tenantId === tenantId && d.id === id);
      if (draft) draft.matchedDocumentId = docId;
    }),
    updateStatus: jest.fn(async (tenantId, id, status, matchedDocId) => {
      const draft = draftsDb.find((d) => d.tenantId === tenantId && d.id === id);
      if (!draft) return null;
      draft.status = status;
      if (matchedDocId !== undefined) draft.matchedDocumentId = matchedDocId;
      draft.updatedAt = new Date();
      return draft;
    }),
  } as unknown as TreasurySmsRepository;

  const mockTreasuryService = {
    createDocument: jest.fn(async (tenantId, dto) => ({
      id: 99,
      kind: dto.kind,
      docNumber: 'RC-101',
      docDate: dto.docDate,
      partyType: dto.partyType,
      partyCode: dto.partyCode,
      partyName: dto.partyName,
      total: dto.methods[0].amount,
      writeoffTotal: '0.00',
      advanceRemaining: '0.00',
      status: 'posted',
      journalEntryId: 501,
      methods: dto.methods,
      allocations: dto.allocations ?? [],
    })),
  } as unknown as TreasuryService;

  let service: TreasurySmsService;
  let controller: TreasurySmsController;

  beforeEach(() => {
    draftsDb = [];
    nextId = 1;
    jest.clearAllMocks();
    service = new TreasurySmsService(mockRepo, mockTreasuryService);
    controller = new TreasurySmsController(service);
  });

  const authRequest = (tenantId = TENANT, sub = USER): AuthenticatedRequest =>
    ({
      user: { tenantId, sub, role: 'user', domain: 'enterprise' },
    } as unknown as AuthenticatedRequest);

  const MELLI_SMS = `بانک ملی ایران
واریز: ۲,۵۰۰,۰۰۰ ریال
حساب: ...۴۳۲۱
مانده: ۱۰,۰۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲-۱۴:۳۰`;

  const MELLAT_SMS = `بانک ملت
برداشت مبلغ: ۵۰۰,۰۰۰ ریال
از: ...۵۶۷۸
مانده: ۱۴,۵۰۰,۰۰۰ ریال
۱۴۰۳/۰۸/۲۲ ۱۲:۱۰`;

  describe('parseSms', () => {
    it('parses valid Melli deposit SMS with exact fields', () => {
      const res = service.parseSms(MELLI_SMS);
      expect(res.bank).toBe(BankCode.MELLI);
      expect(res.direction).toBe('deposit');
      expect(res.docKind).toBe(TreasuryDocKind.RECEIPT);
      expect(res.amountDecimal).toBe('2500000.00');
      expect(res.balanceDecimal).toBe('10000000.00');
      expect(res.accountTail).toBe('4321');
    });

    it('throws BadRequestException on unrecognised SMS', () => {
      expect(() => service.parseSms('تبلیغات ویژه تخفیف نوروزی')).toThrow(BadRequestException);
    });
  });

  describe('captureSms', () => {
    it('captures Melli SMS as a draft receipt', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      expect(draft.id).toBe('draft-1');
      expect(draft.bank).toBe(BankCode.MELLI);
      expect(draft.docKind).toBe(TreasuryDocKind.RECEIPT);
      expect(draft.amount).toBe('2500000.00');
      expect(draft.status).toBe(TreasurySmsDraftStatus.DRAFT);
    });

    it('captures Mellat SMS as a draft payment', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLAT_SMS);
      expect(draft.bank).toBe(BankCode.MELLAT);
      expect(draft.docKind).toBe(TreasuryDocKind.PAYMENT);
      expect(draft.amount).toBe('500000.00');
      expect(draft.status).toBe(TreasurySmsDraftStatus.DRAFT);
    });
  });

  describe('listDrafts and getDraft', () => {
    it('lists drafts filtered by status and docKind', async () => {
      await service.captureSms(TENANT, USER, MELLI_SMS);
      await service.captureSms(TENANT, USER, MELLAT_SMS);

      const all = await service.listDrafts(TENANT);
      expect(all).toHaveLength(2);

      const receipts = await service.listDrafts(TENANT, { docKind: TreasuryDocKind.RECEIPT });
      expect(receipts).toHaveLength(1);
      expect(receipts[0].bank).toBe(BankCode.MELLI);
    });

    it('throws NotFoundException when draft is missing', async () => {
      await expect(service.getDraft(TENANT, 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirmDraft', () => {
    it('confirms draft receipt and posts treasury document', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);

      const confirmed = await service.confirmDraft(TENANT, USER, draft.id, {
        partyCode: 'CUST-01',
        partyName: 'مشتری الف',
        bankAccountId: 5,
      });

      expect(confirmed.id).toBe(99);
      expect(mockTreasuryService.createDocument).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          kind: TreasuryDocKind.RECEIPT,
          partyType: TreasuryPartyType.CUSTOMER,
          partyCode: 'CUST-01',
          partyName: 'مشتری الف',
          methods: [
            expect.objectContaining({
              method: TreasuryMethod.BANK_TRANSFER,
              amount: '2500000.00',
              bankAccountId: 5,
            }),
          ],
        }),
        { tx: true },
      );

      const updatedDraft = await service.getDraft(TENANT, draft.id);
      expect(updatedDraft.status).toBe(TreasurySmsDraftStatus.CONFIRMED);
      expect(updatedDraft.matchedDocumentId).toBe(99);
    });

    it('rejects double confirmation with ConflictException', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      await service.confirmDraft(TENANT, USER, draft.id, {
        partyCode: 'CUST-01',
        partyName: 'مشتری الف',
        bankAccountId: 5,
      });

      await expect(
        service.confirmDraft(TENANT, USER, draft.id, {
          partyCode: 'CUST-01',
          partyName: 'مشتری الف',
          bankAccountId: 5,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('posts only once when two confirms race past the status read', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      const body = { partyCode: 'CUST-01', partyName: 'مشتری الف', bankAccountId: 5 };

      const results = await Promise.allSettled([
        service.confirmDraft(TENANT, USER, draft.id, body),
        service.confirmDraft(TENANT, USER, draft.id, body),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(mockTreasuryService.createDocument).toHaveBeenCalledTimes(1);
    });

    it('does not post when the conditional claim updates 0 rows', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      (mockRepo.claimDraftForConfirm as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.confirmDraft(TENANT, USER, draft.id, { partyCode: 'C', partyName: 'x', bankAccountId: 5 }),
      ).rejects.toThrow(ConflictException);
      expect(mockTreasuryService.createDocument).not.toHaveBeenCalled();
    });

    it('refuses to confirm a rejected draft', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      await service.rejectDraft(TENANT, draft.id);

      await expect(
        service.confirmDraft(TENANT, USER, draft.id, {
          partyCode: 'CUST-01',
          partyName: 'مشتری الف',
          bankAccountId: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectDraft', () => {
    it('marks a draft as rejected', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      const res = await service.rejectDraft(TENANT, draft.id);
      expect(res.status).toBe(TreasurySmsDraftStatus.REJECTED);
    });

    it('refuses to reject an already confirmed draft', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      await service.confirmDraft(TENANT, USER, draft.id, {
        partyCode: 'CUST-01',
        partyName: 'مشتری الف',
        bankAccountId: 5,
      });

      await expect(service.rejectDraft(TENANT, draft.id)).rejects.toThrow(ConflictException);
    });
  });

  describe('Controller endpoints', () => {
    it('controller.parse returns parsed result without saving', () => {
      const res = controller.parse({ text: MELLI_SMS });
      expect(res.bank).toBe(BankCode.MELLI);
      expect(draftsDb).toHaveLength(0);
    });

    it('controller.parse response survives JSON.stringify with decimal-string amounts', () => {
      const res = controller.parse({ text: MELLI_SMS });
      const json = JSON.parse(JSON.stringify(res));
      expect(json.amount).toBe('2500000.00');
      expect(json.balance).toBe('10000000.00');
      expect(json.accountTail).toBe('4321');
      expect(json).not.toHaveProperty('amountMinor');
      expect(json).not.toHaveProperty('balanceMinor');
    });

    it('controller.capture saves draft and returns it', async () => {
      const req = authRequest();
      const res = await controller.capture(req, { text: MELLI_SMS });
      expect(res.id).toBeDefined();
      expect(draftsDb).toHaveLength(1);
    });
  });

  describe('confirm through the real TreasuryService (bank-ledger lookup not mocked)', () => {
    const buildReal = () => {
      const manager = { tx: true };
      const created: any[] = [];
      const repository: any = {
        runInTransaction: jest.fn(async (_t: string, fn: any, outer?: unknown) => fn(outer ?? manager)),
        getTolerance: jest.fn(async () => '0.00'),
        lockTargets: jest.fn(async () => undefined),
        allocatedByTarget: jest.fn(async () => new Map()),
        nextNumber: jest.fn(async () => 7),
        createDocument: jest.fn(async (_t: string, input: any) => {
          const d = { id: 41, status: 'posted', journalEntryId: null, ...input };
          created.push(d);
          return d;
        }),
        addLines: jest.fn(async () => undefined),
        addAllocations: jest.fn(async () => undefined),
        updateDocument: jest.fn(async () => undefined),
        findDocument: jest.fn(async () => ({
          id: 41, kind: 'receipt', status: 'posted', docNumber: 'RC-000007', partyName: 'x', partyCode: 'C1',
          partyType: 'customer', docDate: '2026-11-04', total: '2500000.00', writeoffTotal: '0.00',
          advanceRemaining: '0.00', description: null, journalEntryId: 9,
        })),
        listLines: jest.fn(async () => []),
        listAllocationsOfDocument: jest.fn(async () => []),
      };
      const posting = { postDocument: jest.fn(async () => 9) };
      const banking = { listAccounts: jest.fn(async () => [{ id: 3, ledgerAccountCode: '1012' }]) };
      const real = new TreasuryService(repository, posting as never, banking as never, {} as never, {} as never);
      return { real, posting, banking };
    };

    it('posts the bank line to the chosen account ledger code', async () => {
      const { real, posting, banking } = buildReal();
      const smsService = new TreasurySmsService(mockRepo, real);
      const draft = await smsService.captureSms(TENANT, USER, MELLI_SMS);

      await smsService.confirmDraft(TENANT, USER, draft.id, { partyCode: 'C1', partyName: 'x', bankAccountId: 3 });

      expect(banking.listAccounts).toHaveBeenCalledWith(TENANT);
      expect((posting.postDocument as jest.Mock).mock.calls[0][2].funds).toEqual([
        { accountCode: '1012', amount: expect.anything() },
      ]);
      expect((posting.postDocument as jest.Mock).mock.calls[0][3]).toEqual({ tx: true });
    });

    it('fails with a 400 when the bank account does not exist', async () => {
      const { real } = buildReal();
      const smsService = new TreasurySmsService(mockRepo, real);
      const draft = await smsService.captureSms(TENANT, USER, MELLI_SMS);

      await expect(
        smsService.confirmDraft(TENANT, USER, draft.id, { partyCode: 'C1', partyName: 'x', bankAccountId: 999 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('DTO validation rejects a confirm body without bankAccountId', async () => {
      const dto = plainToInstance(ConfirmTreasurySmsDraftDto, { partyCode: 'C1', partyName: 'x' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'bankAccountId')).toBe(true);
    });
  });
});
