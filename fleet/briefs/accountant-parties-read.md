# Brief: accountant gets READ on the party master (owner decision)
Part 1 (decorator in decorators.ts) is DONE already; do parts 2 to 5 now.

Worktree: your cwd. Backend: `output_apps/enterprise_hub`. DO NOT commit, push, stash. Do not run jest/tsc (I run them).
Do not edit `modules/access/permission-matrix.snapshot.json` (I regenerate it), package.json, lockfiles, migrations, `catalogue.ts` role lists.

## Problem
`modules/parties/controllers/parties.controller.ts` is `@ModuleAccess(AccessModule.CRM)` (class level). `AccessGuard`
(`modules/access/access.guard.ts`) supports exactly one module per route, so the `accountant` role (has accounting:read, no crm:read) cannot read parties.
No role catalogue change is wanted: accountant already holds accounting:read. We need an ALTERNATIVE module on the two GET handlers only.

## Design (keep it tiny)
1. `modules/access/decorators.ts`: add `ACCESS_ALSO_KEY = 'roxira:accessAlsoModules'` and a METHOD decorator
   `AlsoAllowModule = (...modules: AccessModule[]): MethodDecorator => SetMetadata(ACCESS_ALSO_KEY, modules)`.
   Doc comment: it adds alternatives for the SAME action on that handler only; never use it at class level; it never widens a write
   unless the caller wrote it on a write handler.
2. `access.guard.ts`: read the alternatives with `getAllAndOverride<AccessModule[]|undefined>(ACCESS_ALSO_KEY, [context.getHandler()])`
   (handler only, so a class-level decorator cannot leak onto create/update). Replace the module-entitlement + permission block by:
   evaluate the primary module first exactly as today (same error codes, same messages); if it would be denied and alternatives exist,
   evaluate each alternative with the SAME action and the same two checks (entitled unless core module, and `permissions.has(permissionOf(alt, action))`);
   if any alternative passes, allow; otherwise throw the PRIMARY module's denial (unchanged behaviour for everything else).
   Keep it a small private method; no change for routes without the decorator.
3. `parties.controller.ts`: keep `@ModuleAccess(AccessModule.CRM)` on the class; add `@AlsoAllowModule(AccessModule.ACCOUNTING)` to
   `list` and `getByCode` ONLY. `create` and `update` unchanged. Update the class doc comment to say reads are also open to accounting.
4. `modules/access/permission-matrix.spec.ts`: `classify()` must also read ACCESS_ALSO_KEY from the handler and return `also: AccessModule[]`.
   - policy string in the snapshot for such routes: `crm:read|accounting:read` i.e. `[module, ...also].map((m) => `${m}:${action}`).join('|')`
     (unchanged `${module}:${action}` when no alternatives).
   - in the test "matches the permission catalogue on every module route" expected = ANY of the permissions in SYSTEM_ROLES for module+also.
   - `moduleRoutes` helpers (`can(...)`) keep working on the primary module.
   - add to the named expectations: "accountant reads the party master through accounting:read but cannot create or update parties", and
     "no role other than accountant, owner, admin, sales, read_only and legacy_member reads parties; hr and cheque_reviewer do not"
     (use the PartiesController routes by controller name + handler name through `routes`).
5. New spec `modules/parties/parties-access.spec.ts` in the style of `permission-matrix.spec.ts` (reuse `AccessStub` from `test/support/access-stub`, the real
   `AccessGuard`, `Reflector`). For the four handlers list/getByCode/create/update and every role in `SYSTEM_ROLES`, assert the guard outcome.
   Hand-written expectation table (true = allowed):
   - list and getByCode: owner, admin, accountant, sales, read_only, legacy_member true; cheque_reviewer false, hr false.
   - create and update: owner, admin, sales, true; accountant FALSE; cheque_reviewer false; hr false; read_only false; legacy_member: create/update per the
     catalogue (it has crm:create): create true, update true (PUT maps to the `create` action in `actionForMethod`).
   Also: a tenant with accounting NOT entitled but crm entitled, role accountant -> list denied (no crm:read anyway); a tenant with crm not entitled and
   accounting entitled, role accountant -> list ALLOWED (entitlement of the alternative counts); role sales with crm not entitled, accounting entitled -> denied
   (sales has no accounting:read). Look at `AccessStub.grant(user, tenant, role, { entitled: [...] })` in test/support/access-stub.ts for the options.
   Plus a pure test: the decorator is only on those two handlers (check `Reflect.getMetadata(ACCESS_ALSO_KEY, PartiesController.prototype.create)` is undefined and on the class it is undefined).

Print a 5-line summary of files changed at the end. Do not claim tests pass.
