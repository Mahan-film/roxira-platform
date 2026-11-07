# Brief 585: tenant policy settings registry (A/B/C) and five rules (#584 item 1)

Do NOT commit, do NOT push. Work only in this worktree. All paths under `output_apps/enterprise_hub/`.
Owner rule: management chooses business and access rules; code holds a safe default; ledger-integrity limits are fixed and shown as fixed. NEVER write that a rule is "required by law" in any label or comment; do not put statutory numbers in code. Every default equals today's behaviour, so every existing spec must still pass unchanged.

## 1. Storage (migration `migrations/1789900000400-CreateTenantPolicySettings.ts`)
Table `tenant_policy_settings`: `tenant_id uuid NOT NULL`, `key varchar(80) NOT NULL`, `value jsonb NOT NULL`, `updated_by varchar(64) NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`, PK (tenant_id, key). `enableTenantRls` from `./data/tenant-rls` (copy `1789700000002-CreateLandedCosts.ts` style, with `down()`). Raw SQL through `TenantScope` (`modules/access/services/tenant-scope.ts`), no TypeORM entity.

## 2. Registry (`modules/tenants/policy/policy.registry.ts`, pure, no I/O)
`PolicyGroup = 'A'|'B'|'C'` (A fixed, shown read-only; B protects the ledger or a control, lowering it needs a longer reason; C management). Each definition: `key`, `group`, `type: 'enum'|'int'|'bool'`, `allowed` (enum values, or `{min,max}` for int, or `[true]` for A), `default`, `labelFa`, `descriptionFa`, optional `store: 'purchase_settings'`. Export `POLICY_REGISTRY`, `getPolicyDefinition(key)`, `validatePolicyValue(key, value)` returning `{ok:true}|{ok:false, error}` (error text in Persian), `policyDefault(key)`.

Keys (exactly these):
- A (type bool, allowed [true], default true, never stored, never writable):
  - `ledger.posted_voucher_immutable` "سند قطعی‌شده قابل ویرایش یا حذف نیست؛ اصلاح فقط با سند معکوس"
  - `ledger.audit_chain_append_only` "گزارش رخدادها زنجیرهٔ درهم‌تنیده و فقط‌افزودنی است"
  - `ledger.locked_period_refuses_writes` "ثبت در دورهٔ قفل‌شده یا سال مالی بسته پذیرفته نمی‌شود"
- B:
  - `purchase.invoice_review.reviewer_rule` enum `always_differs` (default) | `differs_unless_sole_approver` | `creator_may_accept`. label «قاعدهٔ تأییدکنندهٔ صورتحساب معلق»
  - `fixed_asset.disposal_before_depreciation` enum `refuse` (default) | `allow`. label «فروش دارایی پیش از آخرین سند استهلاک»
- C:
  - `purchase.three_way.qty_excess_tolerance_bp` int 0..1000 default 0, label «تلورانس مقدار اضافهٔ صورتحساب نسبت به رسید (صدم درصد)»
  - `purchase.three_way.price_tolerance_bp` int 0..10000 default 0, `store: 'purchase_settings'` (column `price_tolerance_bp` of the EXISTING table `erp_purchase_settings`)
  - `purchase.three_way.price_tolerance_abs` int 0..1_000_000_000_000 default 0, `store: 'purchase_settings'` (column `price_tolerance_abs`, bigint)
  - `accounting.recurring_voucher.creation_mode` enum `draft_unless_auto_reverse` (default) | `always_post`

Keys with `store: 'purchase_settings'` must NOT go into the new table: read and write them in `erp_purchase_settings` (same upsert semantics as `PurchaseRepository.upsertSettings`; keep the other columns of that row unchanged when only one key changes; a missing row means the defaults). Do not import the inventory module from the policy module (it would be a cycle); use raw SQL on that table inside the policy service.

## 3. Service, controller, module (`modules/tenants/policy/`)
- `PolicyService`: `get(tenantId, key, manager?)` (value or default), `getAll(tenantId)` (every definition with group, type, allowed, default, labelFa, descriptionFa, current value, `isDefault`, updatedAt/updatedBy for stored ones), `set(tenantId, actor {userId, roleKey}, key, value, reason, request?)`.
- `set` rules, in this order: unknown key 404; group A 403 «این قاعده ثابت است»; actor.roleKey must be `owner` or `admin` else 403; `validatePolicyValue` else 400; reason trimmed, at least 5 characters (at least 15 for group B) else 400; same as current value: return current, no write, no audit. Otherwise in ONE `TenantScope.run` transaction: write the value, then `AuditService.record({tenantId, actorUserId, action:'policy.changed', resourceType:'tenant_policy', resourceId:key, metadata:{key, group, oldValue, newValue, reason}}, manager)` (`modules/access/services/audit.service.ts`). Add a second action `policy.changed.protected` instead of `policy.changed` when the group is B.
- `PolicyController` `@Controller('policies')`, `@ModuleAccess(AccessModule.MEMBERS)` (see `modules/access/decorators.ts`): `GET /policies` (and `GET /policies/:key` not needed), `PUT /policies/:key` body `{value, reason}` with `@RequireAction(AccessAction.ADMIN)`. Use `requireAccess(request)` for `userId` and `roleKey`. DTO with class-validator, Persian API docs.
- `TenantPolicyModule` exports `PolicyService`; imports `AccessModule` (for AuditService) and provides its own `TenantScope`. Register it in `app.module.ts` and import it in `InventoryModule` and `AccountingModule`. After adding routes, update `modules/access/permission-matrix.snapshot.json` exactly as `permission-matrix.spec.ts` instructs, and make that spec pass.

## 4. Consumers (each reads the policy; no other behaviour change)
a. `modules/inventory/purchasing/supplier-invoice.service.ts` `acceptInvoice` (currently throws Forbidden when `createdBy === userId`): read `purchase.invoice_review.reviewer_rule`. If the accepter is not the creator: unchanged, no flag. If the accepter is the creator: `always_differs` -> Forbidden as today; `creator_may_accept` -> allowed; `differs_unless_sole_approver` -> allowed only when there is NO other eligible approver, else Forbidden. Eligible approver = another ACTIVE membership of the tenant (user id different from the creator) whose effective permissions include `inventory:approve` (system role through `systemRolePermissions(roleKey)`, or the custom role's permissions as `AccessService.load` does). Add a small method for this count in `AccessService` (or a repository it uses), exported. When the creator accepts, write an audit record (action `purchase.invoice.accepted_by_creator`, resourceType `supplier_invoice`, resourceId invoice id, metadata `{rule, otherApprovers: <count>, note}`) in the same transaction, and the response/audit must make it visible. Keep the 3-character note rule.
b. `invoice-match.domain.ts` `matchInvoiceLine`: add optional `qtyExcessToleranceBp` (default 0) to the settings argument. `allowedExcess = receivedQuantity * bp / 10_000n` (bigint floor). Quantity mismatch only when `qtyExcess > allowedExcess`; the returned `qtyExcess` stays the real excess. Service loads the policy value when creating an invoice and passes it. Price tolerance continues to be read from `erp_purchase_settings` by the existing code (the policy writes the same columns).
c. `modules/accounting/services/recurring-voucher.service.ts` `runOne`: status is `POSTED` when `template.autoReverse` OR policy `accounting.recurring_voucher.creation_mode === 'always_post'`, else `DRAFT`. Reversal date logic stays tied to `autoReverse` only.
d. `modules/accounting/services/fixed-asset.service.ts` `dispose`: the refusal «تاریخ فروش نمی‌تواند پیش از آخرین سند استهلاک…» applies only when policy `fixed_asset.disposal_before_depreciation === 'refuse'`. With `allow` it proceeds (period-lock check still applies). Read the policy inside the same manager.
Inject `PolicyService` (constructor param; update the existing specs' module setup/mocks so they default to registry defaults).

## 5. Specs (hand-computed, do not change a number to make a test pass)
`policy.registry.spec.ts`: every definition has group in A/B/C, a non-empty Persian `labelFa` (contains an Arabic-script letter), and `default` accepted by its own validator; exactly 3 A, 2 B, 4 C keys. Validator: qty tolerance `1000` ok, `1001` bad, `-1` bad, `5.5` bad, `'5'` bad; reviewer rule `'sometimes'` bad; A key with `false` bad.
`invoice-match.domain.spec.ts` additions (received 10000 = 100.00, nothing invoiced before, same unit price as order):
- invoiced 10300, bp 0: excess 300 > 0 -> `QTY_MISMATCH` (today).
- invoiced 10300, bp 300: allowed = 10000*300/10000 = 300; 300 > 300 false -> `MATCHED`.
- invoiced 10300, bp 299: allowed = 2,990,000/10,000 = 299 (floor); 300 > 299 -> `QTY_MISMATCH`.
- invoiced 10600, bp 500: allowed 500; excess 600 > 500 -> `QTY_MISMATCH`; result `qtyExcess` = 600n.
- price (existing logic, pin it): quantity 100.00, order unit price 1000, so order value 100,000; `priceToleranceBp` 500 gives allowed 5,000; unit price 1050 (value 105,000, diff 5,000) -> `MATCHED`; unit price 1051 (diff 5,100 > 5,000) -> `PRICE_MISMATCH`. Check `lineValue` units before writing the numbers and show the arithmetic in a comment if the unit scale differs.
`supplier-invoice.service.spec.ts` additions (creator U1, other user U2): U2 accepts under every rule -> allowed, no `accepted_by_creator` audit. U1 under `always_differs` -> Forbidden. U1 under `creator_may_accept` -> allowed, one audit with `otherApprovers` as counted. U1 under `differs_unless_sole_approver` with 0 other approvers -> allowed + audit `{otherApprovers:0}`; with 1 other approver -> Forbidden, no audit.
`policy.service.spec.ts` (mocked scope/audit): owner sets C key -> value written, exactly one audit `policy.changed` with oldValue (default) and newValue and reason; B key -> action `policy.changed.protected`, reason of 14 chars refused, 15 accepted; `accountant` role refused; group A refused even for owner; same value -> no write and no audit; price tolerance key writes `erp_purchase_settings` and leaves the other price column unchanged; unknown key -> NotFound.
`policy.pg.spec.ts` (copy the opt-in pattern of `supplier-invoice.pg.spec.ts`): non-superuser role cannot read tenant B's policy rows; set in tenant A not visible in tenant B; default returned for an unset key.
Recurring: template `autoReverse=false` -> mode default -> `DRAFT`; mode `always_post` -> `POSTED`; `autoReverse=true` -> `POSTED` in both modes (extend the existing spec).
Disposal: asset with last posted depreciation `2026-03-20` (use the same date format the existing code compares) and disposal date `2026-02-10`: `refuse` -> BadRequest as today; `allow` -> proceeds and posts. Extend the existing fixed-asset service spec.

## 6. Frontend (`frontend/`)
- `src/lib/policy-ui.ts` + `policy-ui.test.ts`: `policyGroupLabel('A'|'B'|'C')` -> «الف: ثابت (غیرقابل تغییر)», «ب: حفاظت از دفتر (دلیل طولانی‌تر)», «ج: تصمیم مدیریت»; `reasonMinLength(group)`: A 0 (not editable), B 15, C 5; `isEditable(group)`. Test those exact values.
- API client functions in `src/lib/api/access-client.ts`: `listPolicies`, `setPolicy(key, value, reason)`; types in `src/types/access.ts`.
- Page `src/app/app/settings/policies/page.tsx` (client component; copy the style of `settings/security/page.tsx`): Persian, RTL, one card per group in order A, B, C, each row: label, description, a badge with the group, current value (A rows show a lock and no control), a select (enum) or number input (int), a reason field with the minimum length hint, a save button, error alert. Show «پیش‌فرض» when `isDefault`. data-testid on rows (`policy-row-<key>`). No new dependency.
- Do NOT edit `src/lib/nav-menu.ts` (hotspot); the coordinator adds the link.

## 7. Verify before you stop
From `output_apps/enterprise_hub`: `npx tsc --noEmit -p tsconfig.json`, then `npx jest modules/tenants modules/inventory/purchasing modules/accounting modules/access/permission-matrix.spec.ts --silent` (all pass), then in `frontend`: `npx tsc --noEmit` and `npx vitest run src/lib/policy-ui.test.ts` (or the project's test runner). Report failures honestly.
