# Task 468b: party import registry + wiring (the core module `modules/parties` already exists, do not change its behaviour)

Worktree: your cwd; backend root `output_apps/enterprise_hub`. Do NOT commit; do not touch app.module.ts, package.json, snapshot, migrations, `.github`, `modules/crm`, `modules/treasury`, e2e. Do not run jest/tsc. Read first: `modules/data_import/registry/inventory-items.registry.ts` (pattern), `registry/import-registry.types.ts`, `normaliser/normalise.ts` (normaliseText already maps Arabic ي/ك to ی/ک and Persian digits to ASCII for `text`-type fields; `normaliseEnumValue` applies `enumAliases` through normaliseKey), `services/entity-import.service.ts` (filterDuplicates: rows whose duplicateKeys repeat in the file or exist already are counted as skipped duplicates), `modules/parties/services/parties.service.ts`.

## Create `modules/data_import/registry/parties.registry.ts`
`@Injectable() export class PartiesRegistry implements EntityImportAdapter`, `key = 'parties'`, `labelFa = 'طرف‌حساب‌ها (مشتری و تأمین‌کننده)'`. Constructor takes `PartiesService` (from `../../parties/services/parties.service`).
Fields (key, type, required):
- `code` text required. synonyms: 'code','party code','کد طرف حساب','کد طرف‌حساب','کد تفصیلی','کد مشتری','کد تامین کننده','کد تأمین‌کننده','PartyCode','CustomerCode'.
- `name` text required. synonyms: 'name','party name','نام طرف حساب','نام و نام خانوادگی','نام مشتری','نام تأمین‌کننده','نام تامین کننده','نام'.
- `role` enum required, enumValues ['customer','supplier','both']; enumAliases (alias -> canonical): 'مشتری','خریدار','customer','buyer' -> customer; 'تأمین‌کننده','تامین‌کننده','تأمین کننده','تامین کننده','فروشنده','supplier','vendor' -> supplier; 'هر دو','مشتری و تأمین‌کننده','مشتری و تامین کننده','both' -> both. synonyms: 'role','type','party type','نقش','نوع طرف حساب','نوع'.
- `nationalId` text optional. synonyms: 'national id','شناسه ملی','کد ملی','شناسه ملی / کد اقتصادی','شناسه ملی / کد اقتصادی آزمایشی','NationalCode'. (Type is `text` on purpose: the real files carry 11-digit legal-entity ids, the `national_id` field type allows only 10.) Validate in `commit`: digits only, 10 or 11 of them, otherwise that row fails with a Persian message.
- `economicCode` text optional. synonyms: 'economic code','کد اقتصادی','EconomicCode'. Digits only, 10 to 14, else row fails.
- `phone` phone optional. synonyms: 'phone','mobile','تلفن','موبایل','شماره تماس','همراه'.
- `email` email optional. synonyms: 'email','رایانامه','ایمیل','پست الکترونیک'.
Methods:
- `duplicateKeys(record)`: `['code:' + code.trim()]` when code is a non-empty string, else [].
- `findExistingDuplicateKeys(tenantId, keys)`: strip the `code:` prefix, call `partiesService.findExistingCodes`, return with prefix.
- `commit(tenantId, records)`: build inputs (trimmed code, name, role, nationalId|null, economicCode|null, phone|null, email|null); per-row validation as above collects `failed`; call `partiesService.upsertMany(tenantId, validInputs)`; rows whose result has `inserted === false` (a concurrent writer got there first) go to `failed` with message 'کد طرف حساب قبلاً ثبت شده است.' and are NOT reported as inserted; the rest go to `inserted` as `{ rowNumber, ownerId: id }`. Match results back to rows by code.
- `undo(tenantId, ownerIds)`: `partiesService.removeByIds(tenantId, ids as number[])` -> `{ removed, refused: [] }`.

## Wire it
- `modules/data_import/data-import.module.ts`: import `PartiesModule`, add `PartiesRegistry` to providers, and to the adapters factory (inject + the returned array) exactly like `InventoryItemsRegistry`.
- Do not register anything in app.module.ts.

## Specs
- `modules/data_import/registry/parties.registry.spec.ts` (mock PartiesService): 
  1. duplicateKeys of code ' CUST-001 ' is ['code:CUST-001'];
  2. role normalisation through `normaliseAndValidate(field, raw)` from `./field-validation` for the role field: 'مشتری' -> 'customer'; 'تأمین‌کننده' (with ZWNJ U+200C) -> 'supplier'; 'تأمین كننده' with Arabic kaf -> 'supplier'; 'هر دو' -> 'both'; 'نامعتبر' -> error;
  3. name 'علي كريمي' normalises to 'علی کریمی' (Persian ی/ک);
  4. commit with 11-digit nationalId passes the validation and is passed to upsertMany; a 9-digit one fails that row only;
  5. commit reports `inserted:false` upsert results as failed, not inserted;
  6. findExistingDuplicateKeys returns prefixed keys; 
  7. the sample header 'کد طرف حساب' / 'نقش' / 'نام و نام خانوادگی' / 'شناسه ملی / کد اقتصادی آزمایشی' / 'تلفن' / 'رایانامه' are all recognised by `scoreEntityHeaders` (from `./entity-detect`) with a score of 6 or more for this adapter, and the adapter ranks first against `CrmLeadsRegistry`-free scoring: just assert the score >= 6.
Report files created and assumptions. Do not claim tests pass.
