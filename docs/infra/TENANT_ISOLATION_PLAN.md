# Tenant Isolation Plan — Roxira Enterprise Modules

Status: **DESIGN / NO CODE CHANGES YET**
Owner: Platform Engineering
Scope: `output_apps/enterprise_hub/modules/{invoicing,accounting,inventory,hr,damages,tax_compliance}`
Reference implementation: `modules/crm` (already tenant-aware)
Auth layer: `modules/auth` + `security/global-guards.ts`

---

## 1. Purpose

Today only **CRM** scopes data per tenant. The six enterprise modules above store
rows globally, so any authenticated user can read or mutate another
organisation's invoices, ledger entries, stock, payroll, damages and tax
signatures. This document specifies:

1. a per-module audit of missing tenant columns, unscoped queries and
   client-supplied identifiers;
2. the target pattern (copied from CRM) where the tenant id comes **only** from
   the verified JWT and is enforced in the repository layer;
3. the exact migration plan (column, backfill, indexes, composite uniques);
4. tenant onboarding (new organisation → tenant id + first ADMIN + route guard);
5. a per-module test plan proving cross-tenant access is denied;
6. rollout order and risks.

Hard rule this plan implements (AGENTS.md §4):

> Every new Postgres table needs an ownership/tenant column, with access checks
> enforced in the NestJS repository layer — never trust a client-supplied tenant
> id alone.

---

## 2. Current state

### 2.1 CRM — the reference pattern

| Concern | Location | Behaviour |
| --- | --- | --- |
| Tenant column on lead | `modules/crm/entities/crm-lead.entity.ts:27` | `@Column({ type: 'uuid', name: 'tenant_id' })` |
| Tenant column on contact | `modules/crm/entities/contact-message.entity.ts:25` | `@Column({ type: 'uuid', name: 'tenant_id' })` |
| Repository takes tenant first | `modules/crm/repositories/crm.repository.ts:42-195` | Every read/write filters `tenantId`; `createLead` stamps it |
| Guarded controller | `modules/crm/controllers/crm.controller.ts:55` | `@UseGuards(JwtAuthGuard)` |
| Tenant from JWT only | `modules/crm/controllers/crm.controller.ts:61-67` | `tenantIdOf()` reads `request.user?.sub`, throws 401 if absent |
| Migration | `migrations/1789120000000-AddCrmTenantIsolation.ts` | `uuid` column, backfill `00000000-0000-0000-0000-000000000001`, `SET NOT NULL`, composite indexes |

**Semantic caveat:** CRM currently uses `request.user.sub` (the **user id**) as
the tenant id (`crm.controller.ts:62`). The JWT has no explicit tenant claim
(`modules/auth/guards/jwt-auth.guard.ts:14-21`). This plan promotes tenant id to
a first-class JWT claim (`tenantId`) and migrates CRM onto it; `sub` remains only
as a transition fallback.

**Gap in the reference itself:** `crm_leads.email` is still globally unique
(`crm-lead.entity.ts:34`, `@Index({ unique: true })`) and was not widened by the
CRM migration. It must become `(tenant_id, email)` (see §5.3).

### 2.2 Auth layer

| Concern | Location | Note |
| --- | --- | --- |
| JWT payload | `modules/auth/guards/jwt-auth.guard.ts:14-21`, `modules/auth/services/auth.service.ts:38-43` | `sub, phone, role, domain` — **no tenant claim** |
| Token issued | `modules/auth/services/auth.service.ts:202-218` | `issueSessionForUser()` signs the payload |
| Guard verifies HS256 | `modules/auth/guards/jwt-auth.guard.ts:59-66` | Sets `request.user` |
| Roles guard | `modules/auth/guards/roles.guard.ts:28-33` | Reads `role` from the token |
| Global registration | `security/global-guards.ts:20-24` | JWT + Roles run on every non-`@Public` route |
| User entity | `modules/auth/entities/user.entity.ts` | **No `tenantId`**; `phone` is globally unique (`:25`) |
| User upsert | `modules/auth/repositories/auth.repository.ts:40-59` | `findOrCreateByPhone()` — tenant-unaware |

`main.ts:27-34` already enables `ValidationPipe({ whitelist: true,
forbidNonWhitelisted: true })`, so an unknown `tenantId` field in a body is
stripped/rejected by default. That is **not** a substitute for repository
scoping.

### 2.3 No controller accepts a client-supplied tenant id (verified)

A repository-wide search for `tenant|Tenant|organizationId|orgId|organisation`
over `output_apps/enterprise_hub/**/*.ts` returns matches **only** in CRM and its
migration. Therefore:

> **No controller in invoicing, accounting, inventory, hr, damages or
> tax_compliance accepts a tenant id today** — there is nothing to remove, and
> nothing new may be added. The DTOs (`CreateInvoiceDto`,
> `CreateJournalEntryDto`, `*Query*Dto`, `*StockDto`, `*PayrollDto`,
> `SignInvoiceDto`) contain no tenant field, and the global `whitelist` pipe
> rejects one if a client sends it.

What **does** exist is the opposite risk: **client-supplied foreign keys** that
reach into globally-shared tables. These must be resolved under the caller's
tenant and are listed per module in §3.

---

## 3. Per-module audit

Legend: **Entity X** = entity lacking a tenant column. References are
`path:line`.

### 3.1 Invoicing (`modules/invoicing`)

**Entities lacking `tenant_id`**
- `InvoiceEntity` — `entities/invoice.entity.ts:44`

**Queries that must be scoped**
- `repositories/invoicing.repository.ts:18` `create`
- `repositories/invoicing.repository.ts:23` `save`
- `repositories/invoicing.repository.ts:27` `findById`
- `repositories/invoicing.repository.ts:31` `findByTaxInvoiceNumber`
- `repositories/invoicing.repository.ts:37` `findAndCount`
- `services/invoicing.service.ts:91` uniqueness check → `findByTaxInvoiceNumber`
- `services/invoicing.service.ts:171` `findAndCount`
- `services/invoicing.service.ts:187` `findOne` → `findById`
- `services/invoicing.service.ts:200` `cancel` → `findById`

**Controllers accepting a client tenant id:** none. Client-supplied identifiers
that must stay tenant-scoped: invoice `id` (`controllers/invoicing.controller.ts:54,65`).

**Other:** `taxInvoiceNumber` is a **global unique index**
(`migrations/1789037877166-CreateInvoicesTable.ts:38`) — must become
`(tenant_id, taxInvoiceNumber)`.

### 3.2 Accounting (`modules/accounting`)

**Entities lacking `tenant_id`**
- `JournalEntryEntity` — `entities/journal-entry.entity.ts:19`
- `JournalEntryLineEntity` — `entities/journal-entry-line.entity.ts:20`
- `ChartOfAccountEntity` — `entities/chart-of-account.entity.ts:13`

> `fin_chart_of_accounts` and `fin_journal_entries` are **shared with the Python
> finance layer** (comments at `chart-of-account.entity.ts:8-10` and
> `migrations/1789050000000-CreateJournalEntryLinesTable.ts:8-9`). Adding
> `tenant_id` here affects that layer too — see risk R2.

**Queries that must be scoped**
- `repositories/accounting.repository.ts:61` `findAllAccounts`
- `repositories/accounting.repository.ts:65` `findAccountByCode`
- `repositories/accounting.repository.ts:69` `findAccountsByCodes`
- `repositories/accounting.repository.ts:76` `createAccount`
- `repositories/accounting.repository.ts:83` `findEntryByNumber`
- `repositories/accounting.repository.ts:89` `findEntryById`
- `repositories/accounting.repository.ts:96` `findAndCountEntries`
- `repositories/accounting.repository.ts:102` `searchEntriesByNumber`
- `repositories/accounting.repository.ts:116` `persistJournalEntry` (header `:126`, lines `:135`, balance `increment` `:145-150`, re-read `:153`)
- `repositories/accounting.repository.ts:164` `getTrialBalance`
- `repositories/accounting.repository.ts:183` `getAccountLedger`
- `services/accounting.service.ts:161` `listAccounts`
- `services/accounting.service.ts:166` `createAccount` (`:167`)
- `services/accounting.service.ts:190` `createJournalEntry` (`:212`, `:224`, `:253`)
- `services/accounting.service.ts:266` `findAllJournalEntries` (`:279`)
- `services/accounting.service.ts:296` `findOneJournalEntry` (`:297`)
- `services/accounting.service.ts:308` `getTrialBalance` (`:310`, `:311`)
- `services/accounting.service.ts:391` `getAccountLedger` (`:395`, `:400`)

**Controllers accepting a client tenant id:** none. Client identifiers that
must resolve within the tenant: journal entry `id`
(`controllers/accounting.controller.ts:88-91`) and `:code`
(`controllers/accounting.controller.ts:111-115`).

**Other:** `entryNumber` unique (`entities/journal-entry.entity.ts:23-25`) and
`code` unique (`entities/chart-of-account.entity.ts:17-19`) are global — must
become `(tenant_id, entry_number)` and `(tenant_id, code)`. The COA seed uses
`ON CONFLICT ("code")` (`migrations/1789050000000-...:61`) and must become
per-tenant aware.

### 3.3 Inventory (`modules/inventory`)

**Entities lacking `tenant_id`**
- `WarehouseEntity` — `entities/warehouse.entity.ts:16`
- `StockItemEntity` — `entities/stock-item.entity.ts:20`
- `FifoBatchEntity` — `entities/fifo-batch.entity.ts:24`

**Queries that must be scoped**
- `repositories/inventory.repository.ts:104` `createWarehouse`
- `repositories/inventory.repository.ts:115` `findAllWarehouses`
- `repositories/inventory.repository.ts:119` `findWarehouseById`
- `repositories/inventory.repository.ts:123` `findWarehouseByName`
- `repositories/inventory.repository.ts:131` `createStockItem`
- `repositories/inventory.repository.ts:138` `saveStockItem`
- `repositories/inventory.repository.ts:142` `findStockItemById`
- `repositories/inventory.repository.ts:146` `findStockItemBySku`
- `repositories/inventory.repository.ts:150` `findAllStockItems`
- `repositories/inventory.repository.ts:154` `findStockItemsAndCount`
- `repositories/inventory.repository.ts:186` `findBatchesBySku`
- `repositories/inventory.repository.ts:207` `getBatchAggregates`
- `repositories/inventory.repository.ts:225` `getWarehouseStock`
- `repositories/inventory.repository.ts:255` `persistInbound` (`findOne` `:259`, `assertWarehouseExists` `:267`)
- `repositories/inventory.repository.ts:293` `persistOutbound` (`findOne` `:297`, FIFO query `:305`)
- `repositories/inventory.repository.ts:361` `assertWarehouseExists` (`findOne` `:368`)
- `services/inventory.service.ts:128` `createWarehouse` (`:131`)
- `services/inventory.service.ts:145` `listWarehouses` (`:146`)
- `services/inventory.service.ts:150` `getWarehouseStock` (`:151`, `:156`)
- `services/inventory.service.ts:181` `createStockItem` (`:184`)
- `services/inventory.service.ts:203` `updateStockItem` (`:207`, `:225`)
- `services/inventory.service.ts:230` `getStockItem` (`:231`)
- `services/inventory.service.ts:239` `getStockItemBySku` (`:240`)
- `services/inventory.service.ts:248` `listStockItems` (`:255`, `:262`)
- `services/inventory.service.ts:276` `getStockItemBatches` (`:277`, `:283`, `:284`)
- `services/inventory.service.ts:304` `receiveStock` (`:310`)
- `services/inventory.service.ts:347` `issueStock` (`:349`)
- `services/inventory.service.ts:385` `getFifoValuation` (`:387`, `:388`)
- `services/inventory.service.ts:436` `computeItemValuationMap` (`:437`)

**Controllers accepting a client tenant id:** none. Client identifiers that must
resolve within the tenant: `warehouseId` (`dto/stock-movement.dto.ts:32,73`),
`sku`, item `id` (`controllers/inventory.controller.ts:68,100,110,121,140,156`).

**Other:** `sku` unique (`entities/stock-item.entity.ts:24`) and warehouse
`name` unique (`entities/warehouse.entity.ts:20`) are global — must become
`(tenant_id, sku)` and `(tenant_id, name)`. `barcode` is only indexed, but should
be `(tenant_id, barcode)` if ever made unique.

### 3.4 HR (`modules/hr`)

**Entities lacking `tenant_id`**
- `EmployeeEntity` — `entities/employee.entity.ts:23`
- `EmploymentContractEntity` — `entities/employment-contract.entity.ts:26`
- `PayslipEntity` — `entities/payslip.entity.ts:31`

**Queries that must be scoped**
- `repositories/hr.repository.ts:54` `countEmployees`
- `repositories/hr.repository.ts:58` `createEmployee`
- `repositories/hr.repository.ts:63` `saveEmployee`
- `repositories/hr.repository.ts:67` `findEmployeeById`
- `repositories/hr.repository.ts:71` `findEmployeeByNationalId`
- `repositories/hr.repository.ts:77` `findEmployeeByNumber`
- `repositories/hr.repository.ts:83` `findAndCountEmployees`
- `repositories/hr.repository.ts:93` `createContract`
- `repositories/hr.repository.ts:100` `findContractById`
- `repositories/hr.repository.ts:107` `findContractByNumber`
- `repositories/hr.repository.ts:116` `findActiveContractByEmployee`
- `repositories/hr.repository.ts:126` `findAndCountContracts`
- `repositories/hr.repository.ts:132` `countActiveContracts`
- `repositories/hr.repository.ts:138` `countEmployeesByStatus`
- `repositories/hr.repository.ts:145` `aggregateActiveContracts`
- `repositories/hr.repository.ts:159` `createPayslip`
- `repositories/hr.repository.ts:166` `findPayslipById`
- `repositories/hr.repository.ts:173` `findPayslipByPeriod`
- `repositories/hr.repository.ts:183` `findAndCountPayslips`
- `repositories/hr.repository.ts:189` `savePayslip`
- `repositories/hr.repository.ts:196` `aggregatePayslips`
- `repositories/hr.repository.ts:225` `buildEmployeeSearchWhere`
- `services/hr.service.ts:183` `generateEmployeeNumber` (`:184`, `:186`)
- `services/hr.service.ts:193` `createEmployee` (`:194`, `:205`)
- `services/hr.service.ts:238` `listEmployees` (`:253`)
- `services/hr.service.ts:268` `findOneEmployee` (`:269`)
- `services/hr.service.ts:276` `updateEmployee` (`:280`, `:286`, `:297`)
- `services/hr.service.ts:340` `createContract` (`:343`, `:354`)
- `services/hr.service.ts:397` `listContracts` (`:400`)
- `services/hr.service.ts:408` `findOneContract` (`:409`)
- `services/hr.service.ts:512` `resolveContract` (`:517`, `:525`, `:533`, `:539`)
- `services/hr.service.ts:554` `calculatePayroll`
- `services/hr.service.ts:578` `issuePayslip` (`:584`, cross-module call `:643`)
- `services/hr.service.ts:680` `listPayslips` (`:696`)
- `services/hr.service.ts:712` `findOnePayslip` (`:713`)
- `services/hr.service.ts:724` `getStats`

**Controllers accepting a client tenant id:** none. Client identifiers that must
resolve within the tenant: query `employeeId`
(`controllers/hr.controller.ts:114-118`), `contractId`/`employeeId`
(`dto/payroll.dto.ts:25,32,59,66`), and path ids.

**Cross-module write:** `issuePayslip` calls
`AccountingService.createJournalEntry` (`services/hr.service.ts:643`). Once
accounting is tenant-scoped, HR must pass its tenant id through this call so the
auto-generated payroll journal entry lands in the right ledger (see §4.3).

**Other:** global uniques to widen:
`hr_employees.employee_number`, `hr_employees.national_id`,
`hr_employment_contracts.contract_number`, `hr_payslips.payslip_number`
(`migrations/1789090000000-CreateHrPayrollTables.ts:46,49,105,168`) and the
composite `UQ_hr_payslips_employee_period (employee_id, period_year, period_month)`
(`:157-158`) → `(tenant_id, employee_id, period_year, period_month)`.

### 3.5 Damages (`modules/damages`)

**Entities lacking `tenant_id`**
- `DamageCalculationEntity` — `entities/damage-calculation.entity.ts:15`

**Queries that must be scoped**
- `repositories/damages.repository.ts:18` `create`
- `repositories/damages.repository.ts:25` `createMany`
- `repositories/damages.repository.ts:32` `findById`
- `repositories/damages.repository.ts:36` `findAndCount`
- `services/damages.service.ts:116` `calculateAndPersist` (`:123`)
- `services/damages.service.ts:142` `enqueueBulkCalculation` (`queue.add` `:145`)
- `services/damages.service.ts:149` `findAll` (`:154`)
- `services/damages.service.ts:169` `findOne` (`:170`)
- `processors/damages-queue.processor.ts:24` `process` (`:30` payload, `:36` persist)

**Controllers accepting a client tenant id:** none. Client identifiers that must
resolve within the tenant: record `id`, `contractReferenceNumber` query
(`dto/query-damage-calculation.dto.ts:24-27`).

**Background job gap (critical):** the bulk endpoint enqueues `{ items }` only
(`services/damages.service.ts:145`), and the processor persists with no tenant
context (`processors/damages-queue.processor.ts:36`). The job payload **must**
carry a `tenantId` captured from the authenticated request at enqueue time, and
the processor must reject jobs without it (see §4.4).

### 3.6 Tax compliance (`modules/tax_compliance`)

**Entities lacking `tenant_id`**
- `TaxInvoiceSignatureEntity` — `entities/tax-invoice-signature.entity.ts:23`
- `TaxSigningKeyEntity` — `entities/tax-signing-key.entity.ts:24`

**Queries that must be scoped**
- `repositories/tax-compliance.repository.ts:27` `createKey`
- `repositories/tax-compliance.repository.ts:32` `saveKey`
- `repositories/tax-compliance.repository.ts:37` `findActiveKey`
- `repositories/tax-compliance.repository.ts:45` `findActiveKeyWithPrivate`
- `repositories/tax-compliance.repository.ts:55` `findKeyById`
- `repositories/tax-compliance.repository.ts:60` `deactivateAllKeys` (**currently updates every row in the table**)
- `repositories/tax-compliance.repository.ts:68` `createSignature`
- `repositories/tax-compliance.repository.ts:75` `saveSignature`
- `repositories/tax-compliance.repository.ts:81` `findSignatureById`
- `repositories/tax-compliance.repository.ts:85` `findSignatureByInvoiceId`
- `repositories/tax-compliance.repository.ts:91` `findSignaturesAndCount`
- `services/tax-compliance.service.ts:77` `onModuleInit` (`:79`, `:81`)
- `services/tax-compliance.service.ts:143` `generateAndPersistKey` (`:155`)
- `services/tax-compliance.service.ts:170` `getActiveKey`
- `services/tax-compliance.service.ts:179` `getActiveKeyWithPrivate`
- `services/tax-compliance.service.ts:192` `generateKeyPair`
- `services/tax-compliance.service.ts:202` `getActiveSigningKey`
- `services/tax-compliance.service.ts:208` `generateCertificateRequest`
- `services/tax-compliance.service.ts:310` `signInvoice` (`:311`, `:313`, `:340`)
- `services/tax-compliance.service.ts:425` `submitSignature` (`:426`)
- `services/tax-compliance.service.ts:460` `findAll` (`:488`)
- `services/tax-compliance.service.ts:504` `findOne` (`:505`)
- `services/tax-compliance.service.ts:513` `getSignedPacket` (`:514`)
- `services/tax-compliance.service.ts:522` `verifySignature` (`:528`, `:533`)

**Controllers accepting a client tenant id:** none. Client identifiers that must
resolve within the tenant: `invoiceId` (`dto/sign-invoice.dto.ts:24`), signature
`id`, `keyId`.

**Cross-module read:** `signInvoice` calls `invoicingService.findOne(dto.invoiceId)`
(`services/tax-compliance.service.ts:311`) — it must pass the caller's tenant and
receive only a same-tenant invoice.

**Other:** global uniques `invoice_id`, `tax_id`, `key_id`
(`migrations/1789080000000-CreateTaxComplianceTables.ts:80,83,40`) must become
composites. `onModuleInit` bootstraps a single global active key
(`services/tax-compliance.service.ts:77-87`) — a per-tenant key model needs lazy
per-tenant creation instead (see §6.4 / risk R5).

### 3.7 Out of scope (for awareness)

`modules/currency` is a static in-memory reference service with no DB entity and
no tenant dimension. `modules/health`, `modules/radar` are out of the requested
scope; radar holds no customer rows but should be reassessed separately.

---

## 4. Target pattern (copy from CRM)

### 4.1 Tenant id comes only from the verified JWT

Add an explicit `tenantId` claim to the JWT (preferred over CRM's `sub` alias):

```ts
// modules/auth/guards/jwt-auth.guard.ts (JwtPayload)
export interface JwtPayload {
  sub: string;          // user id
  tenantId: string;     // NEW — organisation id
  phone: string;
  role: string;
  domain: AuthServiceDomain;
  iat?: number;
  exp?: number;
}
```

`AuthService.issueSessionForUser()` (`modules/auth/services/auth.service.ts:202`)
sets `tenantId: user.tenantId`. `AuthUserDto.fromEntity()`
(`modules/auth/dto/auth-session.dto.ts:31-41`) also exposes it to the client.

Every controller copies the CRM helper verbatim:

```ts
private tenantIdOf(request: AuthenticatedRequest): string {
  const tenantId = request.user?.tenantId ?? request.user?.sub;
  if (!tenantId) {
    throw new UnauthorizedException('شناسه مستأجر در توکن یافت نشد.');
  }
  return tenantId;
}
```

The `?? request.user?.sub` fallback exists only while CRM is being migrated; once
every token carries `tenantId`, remove it.

### 4.2 Enforcement lives in the repository layer

Every repository method takes `tenantId: string` as its **first parameter** and:

- **reads/counts/aggregates:** add `tenantId` to the `where` object or
  `andWhere('x.tenantId = :tenantId', { tenantId })`;
- **writes:** `create({ ...data, tenantId })` and, for updates, target
  `{ id, tenantId }` so a foreign id updates 0 rows;
- **raw query builders:** always constrain the tenant; group/aggregate only after
  filtering;
- **transactions:** pass `tenantId` into the transactional helper and stamp every
  inserted row with it (e.g. `persistJournalEntry`, `persistInbound`,
  `persistOutbound`).

Services receive `tenantId` from the controller and forward it to the
repository; services never read tenant from a DTO. Controllers never query the
DB. This preserves Rule #3 (Repository Pattern, AGENTS.md §2.3).

### 4.3 Client-supplied foreign keys must be tenant-validated

Values such as `employeeId`, `contractId`, `warehouseId`, `invoiceId`, `sku`
and `:code` are resolved **under the caller's tenant**. If the referenced row is
not visible to the tenant, return `404` (not `403`) to avoid existence leaks.
Cross-module calls pass the tenant explicitly, e.g.:

```ts
// HR → Accounting (payroll journal entry)
await this.accountingService.createJournalEntry(tenantId, { ... });

// Tax → Invoicing (sign an invoice)
const invoice = await this.invoicingService.findOne(tenantId, dto.invoiceId);
```

### 4.4 Background jobs carry tenant context

`DamagesService.enqueueBulkCalculation(tenantId, items)` adds the trusted
`tenantId` (captured from the request, never from the body) to the job payload;
`DamagesQueueProcessor.process()` reads it and fails closed if missing or
malformed:

```ts
interface BulkDamageJobPayload { tenantId: string; items: CreateDamageCalculationDto[]; }
```

### 4.5 Never trust body/query

No DTO gains a `tenantId` field. The existing global `ValidationPipe`
(`main.ts:27-34`) with `forbidNonWhitelisted` will reject any attempt to smuggle
one. Ownership is additionally set server-side on every write.

---

## 5. Migration plan

All new columns are **`uuid`**, matching CRM
(`modules/crm/entities/crm-lead.entity.ts:27`). `tenants.id`, `users.id` are
`uuid` too, so the join types line up.

### 5.1 New foundation tables/columns

1. **`tenants`** (new): `id uuid PK DEFAULT uuid_generate_v4()`, `name`,
   `slug unique`, `is_active boolean DEFAULT true`, `created_at`.
2. **`users.tenant_id uuid NOT NULL`** + index, backfilled to the default tenant
   (§5.2). Reconsider `users.phone` uniqueness: if one phone may belong to several
   organisations, replace global `IDX_users_phone`
   (`migrations/1789048000000-CreateUsersTable.ts:41`) with `(tenant_id, phone)`.
3. `ROXIRA_DEFAULT_TENANT_ID` env var is the single source of the backfill id;
   the migration falls back to CRM's literal
   `00000000-0000-0000-0000-000000000001`
   (`migrations/1789120000000-AddCrmTenantIsolation.ts:20`) when unset.

### 5.2 Column backfill strategy (repeat per table)

Idempotent, matching the CRM migration style
(`migrations/1789120000000-AddCrmTenantIsolation.ts:26-55`):

```sql
ALTER TABLE "<table>" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
UPDATE "<table>" SET "tenant_id" = $1 WHERE "tenant_id" IS NULL;  -- $1 = ROXIRA_DEFAULT_TENANT_ID
ALTER TABLE "<table>" ALTER COLUMN "tenant_id" SET NOT NULL;
```

Tables to alter:

| Module | Table(s) |
| --- | --- |
| Foundation | `tenants` (create), `users` |
| Invoicing | `invoices` |
| Accounting | `fin_chart_of_accounts`, `fin_journal_entries`, `fin_journal_entry_lines` |
| Inventory | `erp_warehouses`, `erp_stock_items`, `inventory_fifo_batches` |
| HR | `hr_employees`, `hr_employment_contracts`, `hr_payslips` |
| Damages | `damage_calculations` |
| Tax | `tax_signing_keys`, `tax_invoice_signatures` |
| CRM (reconcile) | `crm_leads`, `contact_messages` already have the column |

Notes:
- `fin_journal_entry_lines` gets its **own** `tenant_id` (denormalised) so line
  queries and the trial-balance aggregate can filter without a join, and so a
  foreign `journal_entry_id` can never leak another tenant's lines.
- Existing production tables are expected to be empty or single-org; the backfill
  assigns everything to the default tenant. Rows whose owning org is known must be
  re-assigned explicitly before the default-tenant fallback (out of scope here).
- Optionally add a DB-level `DEFAULT` of the default tenant during rollout, then
  `DROP DEFAULT` once repositories always set it.

### 5.3 Indexes to create

Query-path composite indexes (CRM precedent:
`migrations/1789120000000-AddCrmTenantIsolation.ts:37,54`):

| Table | Index |
| --- | --- |
| `invoices` | `(tenant_id, status)`, `(tenant_id, created_at)` |
| `fin_journal_entries` | `(tenant_id, date)`, `(tenant_id, entry_number)` |
| `fin_journal_entry_lines` | `(tenant_id, account_id)`, `(tenant_id, journal_entry_id)` |
| `fin_chart_of_accounts` | `(tenant_id, code)` |
| `erp_warehouses` | `(tenant_id, name)` |
| `erp_stock_items` | `(tenant_id, sku)`, `(tenant_id, barcode)` |
| `inventory_fifo_batches` | `(tenant_id, sku, received_date)`, `(tenant_id, warehouse_id)` |
| `hr_employees` | `(tenant_id, employee_number)`, `(tenant_id, national_id)`, `(tenant_id, created_at)` |
| `hr_employment_contracts` | `(tenant_id, contract_number)`, `(tenant_id, employee_id)` |
| `hr_payslips` | `(tenant_id, payslip_number)`, `(tenant_id, employee_id, period_year, period_month)` |
| `damage_calculations` | `(tenant_id, contract_reference_number)`, `(tenant_id, created_at)` |
| `tax_signing_keys` | `(tenant_id, key_id)`, partial `(tenant_id) WHERE is_active` |
| `tax_invoice_signatures` | `(tenant_id, invoice_id)`, `(tenant_id, tax_id)`, `(tenant_id, status)` |
| `crm_leads` | `(tenant_id, email)` (replace global email unique) |

### 5.4 Unique constraints that must become `(tenant_id, …)`

A global unique constraint makes two tenants collide on a natural key
(e.g. the same `taxInvoiceNumber`), leaking existence via `23505` and blocking
legitimate multi-tenancy. **Every one of the following must be dropped and
recreated as a composite** in the same migration as its column add:

| Table | Old (global) | New (composite) | Source |
| --- | --- | --- | --- |
| `invoices` | `taxInvoiceNumber` | `(tenant_id, taxInvoiceNumber)` | `migrations/1789037877166-...:38` |
| `fin_journal_entries` | `entry_number` | `(tenant_id, entry_number)` | `entities/journal-entry.entity.ts:23` |
| `fin_chart_of_accounts` | `code` | `(tenant_id, code)` | `entities/chart-of-account.entity.ts:17` |
| `erp_stock_items` | `sku` | `(tenant_id, sku)` | `entities/stock-item.entity.ts:24` |
| `erp_warehouses` | `name` | `(tenant_id, name)` | `entities/warehouse.entity.ts:20` |
| `hr_employees` | `employee_number` | `(tenant_id, employee_number)` | `migrations/1789090000000-...:46` |
| `hr_employees` | `national_id` | `(tenant_id, national_id)` | `migrations/1789090000000-...:49` |
| `hr_employment_contracts` | `contract_number` | `(tenant_id, contract_number)` | `migrations/1789090000000-...:105` |
| `hr_payslips` | `payslip_number` | `(tenant_id, payslip_number)` | `migrations/1789090000000-...:168` |
| `hr_payslips` | `(employee_id, period_year, period_month)` | `(tenant_id, employee_id, period_year, period_month)` | `migrations/1789090000000-...:157` |
| `tax_signing_keys` | `key_id` | `(tenant_id, key_id)` | `migrations/1789080000000-...:40` |
| `tax_invoice_signatures` | `invoice_id` | `(tenant_id, invoice_id)` | `migrations/1789080000000-...:80` |
| `tax_invoice_signatures` | `tax_id` | `(tenant_id, tax_id)` | `migrations/1789080000000-...:83` |
| `crm_leads` | `email` | `(tenant_id, email)` | `entities/crm-lead.entity.ts:34` (missed by CRM migration) |
| `users` | `phone` | `(tenant_id, phone)` *(if multi-org phones allowed)* | `migrations/1789048000000-...:41` |

Additionally, tax signing keys need a **partial unique**
`(tenant_id) WHERE is_active` so `generateAndPersistKey` keeps exactly one active
key per tenant (today `deactivateAllKeys` deactivates the whole table,
`repositories/tax-compliance.repository.ts:60-62`).

### 5.5 Migration file naming / ordering

One migration per module, timestamped after
`1789120000000-AddCrmTenantIsolation` (e.g. `1789130000000-AddTenantIsolationFoundation`,
`1789140000000-AddInvoicingTenantIsolation`, …), each with a symmetric `down()`
dropping indexes, restoring the global uniques, then dropping the column. Per
AGENTS.md §4, migrations land **only via reviewed PRs** — no direct production
run.

---

## 6. Tenant onboarding

### 6.1 Model

A **tenant** == an organisation. A user belongs to exactly one tenant
(`users.tenant_id`). The first user of a tenant is its `ADMIN`
(`UserRole.ADMIN`, `modules/auth/enums/user-role.enum.ts:8`), which matters
because accounting, HR and tax compliance are `@Roles(UserRole.ADMIN)`
(`accounting.controller.ts:36`, `hr.controller.ts:45`,
`tax-compliance.controller.ts:34`).

### 6.2 Registration flow

Extend the existing OTP flow (`POST /auth/send-otp` → `POST /auth/verify-otp`,
`modules/auth/controllers/auth.controller.ts:65-99`) rather than invent a parallel
system:

1. `POST /auth/send-otp` gains an optional `organizationName` (public, strict
   throttle already applied at `auth.controller.ts:66`).
2. `POST /auth/verify-otp` (`AuthService.verifyOtp`,
   `modules/auth/services/auth.service.ts:151`) completes the OTP check, then:
   - if `organizationName` is present: create the `tenants` row (uuid), then
     `findOrCreateByPhone()` (`auth.repository.ts:40`) and set
     `user.tenantId = <new tenant>`, `role = ADMIN` for the founder;
   - otherwise: resolve the user's existing `tenantId`; a brand-new user with no
     org is placed in the default tenant as `USER` (or rejected, product
     decision).
3. `issueSessionForUser()` (`auth.service.ts:202`) emits a JWT containing both
   `tenantId` and `role`.
4. An existing `ADMIN` can invite members with `POST /auth/members` (new,
   `@Roles(ADMIN)`): creates/finds the user under the **caller's** tenant and
   assigns `LAWYER`/`USER` — role assignment always uses the caller's tenantId,
   never a client-provided one.

### 6.3 Role assignment rules

- Founder of a tenant → `ADMIN`.
- Invited members → role chosen by the inviting ADMIN, constrained to
  `{USER, LAWYER, ADMIN}` and recorded with `users.tenant_id = caller.tenantId`.
- `RolesGuard` continues to read `role` from the verified token
  (`modules/auth/guards/roles.guard.ts:28-33`); the tenant is enforced separately
  in repositories.

### 6.4 Per-tenant tax signing keys

`onModuleInit` cannot know a tenant (`tax-compliance.service.ts:77`). Replace the
global bootstrap with **lazy per-tenant creation**: `getActiveKey(tenantId)` /
`getActiveKeyWithPrivate(tenantId)` create a key for that tenant on first use,
and `deactivateAllKeys(tenantId)` scopes to the tenant. Every tenant then has its
own RSA key and `tax_signing_keys` partial-unique `(tenant_id) WHERE is_active`
holds.

### 6.5 Client-side route guard

The session is stored in `localStorage`
(`frontend/src/lib/api/auth-client.ts:64`), so Next.js middleware
(`frontend/src/middleware.ts`) cannot inspect it server-side. Add a
defense-in-depth **client** guard and wrap every enterprise page.

```tsx
// frontend/src/components/auth/enterprise-route-guard.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

export function EnterpriseRouteGuard({
  children, requireAdmin = false,
}: { children: React.ReactNode; requireAdmin?: boolean }) {
  const { isAuthenticated, isLoading, user, openLogin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) { openLogin(); return; }
    if (requireAdmin && user?.role !== "ADMIN") { router.replace("/"); }
  }, [isLoading, isAuthenticated, requireAdmin, user, openLogin, router]);

  if (isLoading) return null;
  if (!isAuthenticated) return null;
  if (requireAdmin && user?.role !== "ADMIN") return null;
  return <>{children}</>;
}
```

Apply to:
- `frontend/src/app/accounting/page.tsx` (admin)
- `frontend/src/app/hr/page.tsx` (admin)
- `frontend/src/app/invoicing/page.tsx`
- `frontend/src/app/inventory/page.tsx`
- `frontend/src/app/crm/page.tsx`
- `frontend/src/app/damages/page.tsx`
- tax-compliance panel (`frontend/src/components/invoicing/tax-compliance-panel.tsx`, admin)

`EnterpriseRouteGuard` is **UX only**; the authoritative check remains the
repository scoping. Pages currently render immediately
(`accounting/page.tsx:69`, `crm/page.tsx:120`), so wrapping is a small diff.

---

## 7. Test plan

Backend tests use the existing Jest setup (`package.json:71-92`,
`testRegex: ".*\\.spec\\.ts$"`, supertest available; `test:e2e` via
`./test/jest-e2e.json`). Each module gets a tenant-isolation spec. Fixtures:
tenant **A** and tenant **B**, each with an ADMIN JWT signed with the test secret
(cf. `security/global-guards.spec.ts:68-69`) that now also carries `tenantId`.

### 7.1 Guard / auth
`modules/auth/guards/jwt-auth.guard.spec.ts`
- A token without `tenantId` → 401 on an enterprise route (fail closed).
- A token with a forged `tenantId` signed by another secret → 401.
- `RolesGuard`: non-ADMIN blocked (403) from accounting/hr/tax routes.

### 7.2 Per-module cross-tenant specs

| Module | Spec file | Cases |
| --- | --- | --- |
| Invoicing | `modules/invoicing/invoicing.tenant.spec.ts` | A cannot `GET /invoicing/:id` of B's invoice (404); A cannot `PATCH /:id/cancel` B's invoice; list returns only A's rows; A and B may reuse the same `taxInvoiceNumber`. |
| Accounting | `modules/accounting/accounting.tenant.spec.ts` | A cannot read B's journal entry (404), ledger of B's account code (404), or see B's rows in trial balance; A and B may reuse `entryNumber` and account `code`; `persistJournalEntry` stamps tenant and only increments A's account balance. |
| Inventory | `modules/inventory/inventory.tenant.spec.ts` | A cannot read/update B's stock item or warehouse; `receiveStock`/`issueStock` with B's `warehouseId` → 404; FIFO batches/valuation exclude B; A and B may reuse `sku` / warehouse `name`. |
| HR | `modules/hr/hr.tenant.spec.ts` | A cannot list/get/update B's employee; `createContract` with B's `employeeId` → 404; payroll/`issuePayslip` with B's `employeeId`/`contractId` → 404; A and B may reuse `employeeNumber`/`nationalId`; payslip uniqueness is per `(tenant, employee, period)`; the auto journal entry is created under A's tenant (assert via accounting repo). |
| Damages | `modules/damages/damages.tenant.spec.ts` | A cannot get/list B's record; bulk job payload carries A's tenant; processor writes rows stamped with A; a job without `tenantId` is rejected and persists nothing. |
| Tax compliance | `modules/tax_compliance/tax-compliance.tenant.spec.ts` | A cannot read B's signature (`GET /:id`, `/packet`, `/verify`) or B's key; `signInvoice` with B's `invoiceId` → 404; A and B may each hold an active signing key; `deactivateAllKeys` only affects A; signed packets never expose B's data. |

### 7.3 Repository-level asserts
For every repository method, assert the emitted `where`/query contains
`tenantId` (mock `Repository`/`EntityManager`) and that `create`/`save` stamps it.
This catches regressions where a new method forgets scoping even if no e2e path
exercises it yet.

### 7.4 Frontend
`frontend/src/components/auth/enterprise-route-guard.spec.tsx`
- unauthenticated visit to `/accounting` triggers login;
- `USER` blocked from admin pages; `ADMIN` allowed.

### 7.5 CI wiring
Add a `db:test:up` step (ephemeral Postgres, e.g. Testcontainers/docker) so the
migrations + composite-unique behaviour run against real Postgres; the negative
tests rely on real constraint/`WHERE` semantics.

---

## 8. Rollout order

Each step = one reviewed PR: migration + entity + repository + service +
controller + tests, deployed with the read/write scoping active.

0. **Foundation** — `tenants` table, `users.tenant_id`, `tenantId` JWT claim,
   onboarding endpoints, route guard. Must land first so every later module has a
   tenant to read.
1. **CRM reconcile** — switch `tenantIdOf` to `request.user.tenantId` (fallback
   to `sub`), widen `crm_leads.email` to `(tenant_id, email)`.
2. **Invoicing** — `invoices.tenant_id`, composite `taxInvoiceNumber` unique,
   repo/service scoping.
3. **Accounting + HR together** — they are coupled through the payroll journal
   entry (`services/hr.service.ts:643`); land both in one wave so the
   cross-module call passes the tenant from day one.
4. **Inventory** — warehouses, stock items, FIFO batches, transactional inbound/
   outbound.
5. **Damages** — record scoping + queue payload change + processor fail-closed.
6. **Tax compliance** — signatures + per-tenant signing keys; replace
   `onModuleInit` global bootstrap with lazy per-tenant creation.

Dependencies: 3 depends on 0–2; 6 depends on 2 (`signInvoice` reads invoices);
5 depends only on 0.

---

## 9. Risks and mitigations

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| R1 | Global unique constraints not converted → cross-tenant `23505` collisions and existence leaks | High | §5.4 converts every natural key to `(tenant_id, …)` in the **same** migration as the column add. |
| R2 | `fin_chart_of_accounts` / `fin_journal_entries` are shared with the Python finance layer | High | Coordinate before migration; backfill default tenant; verify the Python layer ignores/filters `tenant_id`; do not make the column `NOT NULL` for those tables until the Python writer sets it. |
| R3 | COA seed `ON CONFLICT ("code")` (`1789050000000-...:61`) becomes wrong per tenant | Medium | Re-seed per tenant after onboarding; change conflict target to `(tenant_id, code)`. |
| R4 | Missing `tenantId` in old JWTs after the claim is added | Medium | Keep `?? request.user?.sub` fallback during a token-TTL grace window; repositories still scope by the derived id. |
| R5 | Tax `deactivateAllKeys` / `onModuleInit` operate globally | High | Scope to tenant + lazy per-tenant key creation (§6.4); partial unique `(tenant_id) WHERE is_active`. |
| R6 | Damages queue jobs lack tenant | High | Payload carries trusted `tenantId`; processor fails closed (§4.4). |
| R7 | Backfill mis-assigns a row to the default tenant, orphaning real data | Medium | Audit row counts per table; allow explicit per-org re-assignment before/after backfill; keep `down()` reversible. |
| R8 | CRM's `sub == tenantId` semantic diverges from org tenancy | Medium | Introduce explicit claim and migrate CRM (step 1); decide whether a user can belong to multiple orgs (affects `(tenant_id, phone)`). |
| R9 | Client-supplied foreign keys used before tenant validation | High | Resolve all foreign ids under the tenant and return 404 on mismatch (§4.3); add tests per module (§7). |
| R10 | Route guard bypass (client-side only) | Low (UX) | Guard is defense-in-depth; server repository is authoritative. |
| R11 | Rollout leaves some modules unscoped while others are scoped | Medium | Follow the ordered waves; add repository-level asserts in CI so unscoped methods fail fast. |

---

## 10. Appendix — entity/column matrix

| Module | Entity (table) | Add `tenant_id` | Widen unique(s) |
| --- | --- | --- | --- |
| Foundation | `UserEntity` (`users`) | yes | `phone` → `(tenant_id, phone)`* |
| Invoicing | `InvoiceEntity` (`invoices`) | yes | `taxInvoiceNumber` |
| Accounting | `ChartOfAccountEntity` (`fin_chart_of_accounts`) | yes | `code` |
| Accounting | `JournalEntryEntity` (`fin_journal_entries`) | yes | `entry_number` |
| Accounting | `JournalEntryLineEntity` (`fin_journal_entry_lines`) | yes | — |
| Inventory | `WarehouseEntity` (`erp_warehouses`) | yes | `name` |
| Inventory | `StockItemEntity` (`erp_stock_items`) | yes | `sku` |
| Inventory | `FifoBatchEntity` (`inventory_fifo_batches`) | yes | — |
| HR | `EmployeeEntity` (`hr_employees`) | yes | `employee_number`, `national_id` |
| HR | `EmploymentContractEntity` (`hr_employment_contracts`) | yes | `contract_number` |
| HR | `PayslipEntity` (`hr_payslips`) | yes | `payslip_number`, `(employee, year, month)` |
| Damages | `DamageCalculationEntity` (`damage_calculations`) | yes | — |
| Tax | `TaxSigningKeyEntity` (`tax_signing_keys`) | yes | `key_id` + partial active-unique |
| Tax | `TaxInvoiceSignatureEntity` (`tax_invoice_signatures`) | yes | `invoice_id`, `tax_id` |
| CRM (existing) | `CrmLeadEntity` (`crm_leads`) | already | `email` (missed) |
| CRM (existing) | `ContactMessageEntity` (`contact_messages`) | already | — |

\* only if a phone may belong to more than one organisation; otherwise keep the
global unique and simply add `tenant_id` to `users`.
