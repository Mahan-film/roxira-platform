import 'reflect-metadata';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { requestWithAccess } from '../test/support/access-stub';
import { AuthenticatedRequest } from '../modules/auth/guards/jwt-auth.guard';
import { UserRole } from '../modules/auth/enums/user-role.enum';
import { TenantRole } from '../modules/tenants/enums/tenant-role.enum';
import { PipelineStage } from '../modules/crm/enums/crm.enums';
import { McpToolsService } from './mcp-tools.service';

/** کاربر تأییدشده ساختگی (پیلود JWT). */
const requestWith = (user: Record<string, unknown>): AuthenticatedRequest =>
  requestWithAccess(user);

const TENANT_ID = 'tenant-1';
const admin = requestWith({ role: UserRole.ADMIN, tenantId: TENANT_ID });
const owner = requestWith({
  role: UserRole.USER,
  tenantId: TENANT_ID,
  tenantRole: TenantRole.OWNER,
});
const member = requestWith({
  role: UserRole.USER,
  tenantId: TENANT_ID,
  tenantRole: TenantRole.MEMBER,
});

describe('McpToolsService', () => {
  const crmService = {
    listLeads: jest.fn(),
    getLead: jest.fn(),
  };
  const hrService = {
    listEmployees: jest.fn(),
  };
  const inventoryService = {
    listStockItems: jest.fn(),
    getWarehouseStock: jest.fn(),
  };
  const accountingService = {
    getTrialBalance: jest.fn(),
    getAccountLedger: jest.fn(),
  };
  const entityImportService = {
    listEntities: jest.fn(),
    listBatches: jest.fn(),
  };

  const service = new McpToolsService(
    crmService as never,
    hrService as never,
    inventoryService as never,
    accountingService as never,
    entityImportService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // read tools
  // ---------------------------------------------------------------------------

  describe('crm_list_leads', () => {
    it('uses the JWT tenant and clamps the limit to at most 100', async () => {
      crmService.listLeads.mockResolvedValue({ data: [], total: 0 });

      await service.crmListLeads(
        requestWith({ tenantId: TENANT_ID }),
        { search: 'acme', stage: PipelineStage.NEW, limit: 500 },
      );

      expect(crmService.listLeads).toHaveBeenCalledWith(TENANT_ID, {
        page: 1,
        limit: 100,
        search: 'acme',
        stage: PipelineStage.NEW,
      });
    });

    it('never takes the tenant from tool arguments (tenant isolation)', async () => {
      crmService.listLeads.mockResolvedValue({ data: [], total: 0 });

      await service.crmListLeads(
        requestWith({ tenantId: TENANT_ID }),
        { tenantId: 'attacker', limit: 10 } as never,
      );

      expect(crmService.listLeads).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('rejects a caller without a tenant', async () => {
      await expect(
        service.crmListLeads(requestWith({ sub: 'u1' }), {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('crm_get_lead', () => {
    it('delegates to the CRM service with the JWT tenant', async () => {
      crmService.getLead.mockResolvedValue({ id: 7 });

      await service.crmGetLead(owner, { id: 7 });

      expect(crmService.getLead).toHaveBeenCalledWith(TENANT_ID, 7);
    });
  });

  describe('hr_list_employees', () => {
    it('allows an admin and clamps the limit', async () => {
      hrService.listEmployees.mockResolvedValue({ data: [], total: 0 });

      await service.hrListEmployees(admin, { search: 'sara', limit: 250 });

      expect(hrService.listEmployees).toHaveBeenCalledWith(TENANT_ID, {
        page: 1,
        limit: 100,
        search: 'sara',
      });
    });

    it('rejects a non-admin member', async () => {
      await expect(
        service.hrListEmployees(member, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('inventory_list_items', () => {
    it('delegates to the inventory service with the JWT tenant', async () => {
      inventoryService.listStockItems.mockResolvedValue({ data: [] });

      await service.inventoryListItems(owner, { limit: 5 });

      expect(inventoryService.listStockItems).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({ limit: 5, lowStockOnly: false }),
      );
    });
  });

  describe('inventory_stock', () => {
    it('delegates the warehouse stock query', async () => {
      inventoryService.getWarehouseStock.mockResolvedValue({ rows: [] });

      await service.inventoryStock(owner, { warehouseId: 3 });

      expect(inventoryService.getWarehouseStock).toHaveBeenCalledWith(
        TENANT_ID,
        3,
      );
    });
  });

  describe('accounting_trial_balance', () => {
    it('allows an admin and delegates to the accounting service', async () => {
      accountingService.getTrialBalance.mockResolvedValue({ rows: [] });

      await service.accountingTrialBalance(admin);

      expect(accountingService.getTrialBalance).toHaveBeenCalledWith(TENANT_ID);
    });

    it('rejects a non-admin member', async () => {
      await expect(
        service.accountingTrialBalance(member),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('accounting_account_ledger', () => {
    it('clamps the ledger limit to 100', async () => {
      accountingService.getAccountLedger.mockResolvedValue({ entries: [] });

      await service.accountingAccountLedger(admin, { code: '1010', limit: 900 });

      expect(accountingService.getAccountLedger).toHaveBeenCalledWith(
        TENANT_ID,
        '1010',
        { limit: 100 },
      );
    });
  });

  describe('import_list_entities', () => {
    it('returns the entity descriptors', () => {
      const descriptors = [{ key: 'crm-leads', labelFa: 'سرنخ', fields: [] }];
      entityImportService.listEntities.mockReturnValue(descriptors);

      expect(service.importListEntities(owner)).toBe(descriptors);
    });
  });

  describe('import_list_batches', () => {
    it('allows the tenant owner and scopes to the JWT tenant', async () => {
      entityImportService.listBatches.mockResolvedValue([]);

      await service.importListBatches(owner);

      expect(entityImportService.listBatches).toHaveBeenCalledWith(TENANT_ID);
    });

    it('rejects a plain member', async () => {
      await expect(
        service.importListBatches(member),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // propose tools (no write)
  // ---------------------------------------------------------------------------

  describe('crm_propose_lead', () => {
    it('returns a proposal and warns on a duplicate email', async () => {
      crmService.listLeads.mockResolvedValue({
        data: [{ id: 1, email: 'sara@example.com' }],
        total: 1,
      });

      const proposal = await service.crmProposeLead(owner, {
        fullName: 'سارا محمدی',
        email: 'Sara@Example.com',
      } as never);

      expect(proposal.kind).toBe('crm.lead');
      expect(proposal.payload.email).toBe('sara@example.com');
      expect(proposal.warnings).toHaveLength(1);
    });

    it('returns no warnings when the lead is new', async () => {
      crmService.listLeads.mockResolvedValue({ data: [], total: 0 });

      const proposal = await service.crmProposeLead(owner, {
        fullName: 'علی رضایی',
        email: 'ali@example.com',
      } as never);

      expect(proposal.warnings).toEqual([]);
    });
  });

  describe('hr_propose_employee', () => {
    it('warns on a duplicate national id (admin only)', async () => {
      hrService.listEmployees.mockResolvedValue({
        data: [{ id: 2, nationalId: '0079541234' }],
        total: 1,
      });

      const proposal = await service.hrProposeEmployee(admin, {
        firstName: 'سارا',
        lastName: 'محمدی',
        nationalId: '0079541234',
        mobile: '09121234567',
        jobTitle: 'کارشناس',
        department: 'منابع انسانی',
      } as never);

      expect(proposal.kind).toBe('hr.employee');
      expect(proposal.warnings).toHaveLength(1);
    });

    it('rejects a non-admin member', async () => {
      await expect(
        service.hrProposeEmployee(member, {} as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('accounting_propose_journal', () => {
    const balanced = {
      lines: [
        { accountCode: '1010', debit: 1000, description: 'نقد' },
        { accountCode: '4010', credit: 1000, description: 'درآمد' },
      ],
    };

    it('returns a balanced proposal for an admin', () => {
      const proposal = service.accountingProposeJournal(admin, balanced as never);

      expect(proposal.kind).toBe('accounting.journal');
      expect(proposal.payload.totalDebit).toBe(1000);
      expect(proposal.payload.totalCredit).toBe(1000);
    });

    it('rejects an unbalanced journal', () => {
      expect(() =>
        service.accountingProposeJournal(admin, {
          lines: [
            { accountCode: '1010', debit: 1000 },
            { accountCode: '4010', credit: 500 },
          ],
        } as never),
      ).toThrow(BadRequestException);
    });

    it('rejects a non-admin member', () => {
      expect(() =>
        service.accountingProposeJournal(member, balanced as never),
      ).toThrow(ForbiddenException);
    });
  });
});
