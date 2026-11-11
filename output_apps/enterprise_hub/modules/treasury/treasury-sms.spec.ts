import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
      });

      await expect(
        service.confirmDraft(TENANT, USER, draft.id, {
          partyCode: 'CUST-01',
          partyName: 'مشتری الف',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to confirm a rejected draft', async () => {
      const draft = await service.captureSms(TENANT, USER, MELLI_SMS);
      await service.rejectDraft(TENANT, draft.id);

      await expect(
        service.confirmDraft(TENANT, USER, draft.id, {
          partyCode: 'CUST-01',
          partyName: 'مشتری الف',
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

    it('controller.capture saves draft and returns it', async () => {
      const req = authRequest();
      const res = await controller.capture(req, { text: MELLI_SMS });
      expect(res.id).toBeDefined();
      expect(draftsDb).toHaveLength(1);
    });
  });
});
