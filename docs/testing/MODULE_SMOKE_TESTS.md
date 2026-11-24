# Playwright Module Smoke Tests (T1416 / L11 QA)

End-to-end browser smoke test suite per module across core business domains:
1. **Accounting** (`accounting`) — `/app/accounting/vouchers` (Lane: L5)
2. **Invoicing** (`invoicing`) — `/app/invoicing` (Lane: L2)
3. **Inventory** (`inventory`) — `/app/inventory` (Lane: L2 / L9)
4. **HR** (`hr`) — `/app/hr` (Lane: L1 / L7)
5. **CRM** (`crm`) — `/app/crm` (Lane: L9)
6. **Settings** (`settings`) — `/app/settings/members` (Lane: L1 / L3)

## Standard Execution Lifecycle Per Module
Each smoke spec strictly executes the standard 5-step operational lifecycle:
1. **Open Module**: Navigates to the module route on localhost.
2. **Create Record**: Submits a new entity with valid synthetic test data.
3. **Verify in List**: Confirms the entity appears in list/table.
4. **Reload**: Reloads the page (`page.reload`) and confirms persistence across reloads.
5. **Delete / Cancel**: Cancels or revokes the entity, ensuring clean lifecycle termination.

## How to Run

### Run Full Multi-Module Suite
```bash
cd e2e
npx playwright test module-smoke.spec.ts --project=chromium --reporter=list
```

### Run Individual Module Specs
```bash
cd e2e
# Accounting
npx playwright test e2e/tests/module-smoke/accounting.spec.ts --project=chromium

# Invoicing
npx playwright test e2e/tests/module-smoke/invoicing.spec.ts --project=chromium

# Inventory
npx playwright test e2e/tests/module-smoke/inventory.spec.ts --project=chromium

# HR
npx playwright test e2e/tests/module-smoke/hr.spec.ts --project=chromium

# CRM
npx playwright test e2e/tests/module-smoke/crm.spec.ts --project=chromium

# Settings
npx playwright test e2e/tests/module-smoke/settings.spec.ts --project=chromium
```

### Environment Configuration
- `APP_E2E_BASE_URL` or `E2E_BASE_URL`: Frontend URL (default: `http://127.0.0.1:3901` or `http://127.0.0.1:3001`).
- `APP_E2E_SESSION_FILE`: Path to session JSON (pre-seeded tenant). If omitted, tests automatically create a synthetic account via `/signup`.

## Bug Triage and Issue Reporting
When a smoke test encounters a failure caused by product code (rather than test infrastructure), it logs screenshots, console errors, and network request traces in `smoke-results/bugs.md` and generates a GitHub issue labeled with the respective module's lane:
- Accounting failures -> `lane:L5`
- Invoicing failures -> `lane:L2`
- Inventory failures -> `lane:L2`
- HR failures -> `lane:L1`
- CRM failures -> `lane:L9`
- Settings / Access failures -> `lane:L1` / `lane:L3`
