# Ledger Audit Report

## Entities and Tables

### Chart of Accounts

- **Table**: `fin_chart_of_accounts`
- **Columns**:
  - `id` (Primary Key)
  - `code` (Unique, 32 chars)
  - `name` (128 chars)
  - `account_type` (Enum: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE)
  - `currency` (3 chars, default 'IRR')
  - `balance` (Double precision, default 0)

### Journal Entries

- **Table**: `fin_journal_entries`
- **Columns**:
  - `id` (Primary Key)
  - `entry_number` (Unique, 64 chars)
  - `date` (Timestamp)
  - `description` (Text)
  - `status` (Enum: POSTED, DRAFT, VOID)

### Journal Entry Lines

- **Table**: `fin_journal_entry_lines`
- **Columns**:
  - `id` (Primary Key)
  - `journal_entry_id` (Foreign Key to Journal Entries)
  - `account_id` (Foreign Key to Chart of Accounts)
  - `debit` (Numeric, 18,2)
  - `credit` (Numeric, 18,2)
  - `description` (Text, nullable)

## Code Paths

### Creating Journal Entries

1. **Controller**: `POST /enterprise-hub/accounting/journal-entries`
   - Validates DTO with `CreateJournalEntryDto`
   - Calls `AccountingService.createJournalEntry()`

2. **Service**:
   - Validates entry is balanced (debit = credit)
   - Checks for duplicate entry numbers
   - Verifies all account codes exist
   - Normalizes line amounts
   - Calls `AccountingRepository.persistJournalEntry()`

3. **Repository**:
   - Creates transaction with:
     - Journal entry header
     - Journal entry lines
     - Account balance updates

### Updating Journal Entries

- No direct update paths found. Entries appear immutable.

### Deleting Journal Entries

- No delete paths found. Entries appear immutable.

## Invariants

1. **Debit = Credit**: Enforced in service layer before persistence
2. **Immutable Entries**: No update/delete paths found
3. **No Periods**: No period-closing functionality observed
4. **No Idempotency Key**: No unique request ID tracking
5. **Currency Handling**:
   - Single currency per entry (all lines must share currency)
   - Rounding to 2 decimal places
   - Base currency conversion for reporting

## Tenant Isolation

- **No Tenant/Owner Columns**: None found in any financial tables
- **No Repository Filters**: No tenant filtering in repository queries

## Authentication/Authorization

- **Routes**:
  - All routes require authentication (NestJS guards)
  - No specific role-based access control observed

## Reports

1. **Trial Balance**: `GET /enterprise-hub/accounting/trial-balance`
2. **Account Ledger**: `GET /enterprise-hub/accounting/accounts/:code/ledger`

## Tests

- No test files found in the scanned paths

## Gaps

1. **Tenant Isolation**: No tenant columns or filtering
2. **Period Management**: No period-closing functionality
3. **Idempotency**: No request deduplication
4. **Audit Trail**: No change history tracking
5. **Role-Based Access**: No granular permissions
6. **Test Coverage**: No tests for core functionality
7. **Error Handling**: No specific error codes or handling
8. **Documentation**: No API documentation for error cases
9. **Validation**: No input validation for dates or descriptions
10. **Currency Support**: No multi-currency entry support
11. **Reporting**: No P&L or balance sheet endpoints
12. **Immutability**: No versioning or soft-deletion support
