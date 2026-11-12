import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  duplicateReasonLabel,
  parseDryRunJsonPayload,
  sourceDisplayLabel,
  summarizeDryRunGate,
  unmappedReasonLabel,
  type ImportDryRunReport,
} from "./import-dry-run-helpers.ts";

function makeSampleReport(overrides: Partial<ImportDryRunReport> = {}): ImportDryRunReport {
  return {
    source: "sepidar",
    dryRun: true,
    rolledBack: true,
    tenantId: "00000000-0000-4000-8000-000000000001",
    generatedAt: "2026-11-12T12:00:00.000Z",
    readyToCommit: true,
    blockersFa: [],
    warningsFa: [],
    counts: {
      accounts: { incoming: 10, wouldInsert: 10, existingSkipped: 0, invalidCount: 0 },
      parties: { incoming: 4, wouldInsert: 4, existingSkipped: 0, invalidCount: 0, duplicates: 0 },
      items: { incoming: 3, wouldInsert: 3, existingSkipped: 0, invalidCount: 0 },
      openingLines: { incoming: 2, wouldInsert: 2, existingSkipped: 0, invalidCount: 0, unmapped: 0 },
      cheques: { incoming: 2, wouldInsert: 2, existingSkipped: 0, invalidCount: 0, openValid: 2, closedSkipped: 0 },
    },
    openingTrialBalance: {
      balanced: true,
      totalDebitMinor: "15000000000",
      totalCreditMinor: "15000000000",
      varianceMinor: "0",
      totalDebitRial: "150000000.00",
      totalCreditRial: "150000000.00",
      varianceRial: "0.00",
      lineCount: 2,
      persistedInTx: true,
      accounts: [],
    },
    unmappedAccounts: [],
    duplicateParties: [],
    openCheques: {
      totalCount: 2,
      totalAmountMinor: "13000000000",
      totalAmountRial: "130000000.00",
      receivedCount: 1,
      receivedAmountMinor: "8500000000",
      receivedAmountRial: "85000000.00",
      issuedCount: 1,
      issuedAmountMinor: "4500000000",
      issuedAmountRial: "45000000.00",
      endorsedCount: 0,
      endorsedAmountMinor: "0",
      endorsedAmountRial: "0.00",
      wouldInsertCount: 2,
      existingSkippedCount: 0,
      invalidErrors: [],
    },
    txVerification: {
      dbAccountsAfterInsert: 10,
      dbPartiesAfterInsert: 4,
      dbItemsAfterInsert: 3,
      dbOpeningLinesAfterInsert: 2,
      dbChequesAfterInsert: 2,
    },
    ...overrides,
  };
}

test("parseDryRunJsonPayload accepts valid non-empty JSON batch and synthetic flag", () => {
  const withRows = parseDryRunJsonPayload(JSON.stringify({ accounts: [{ Code: "1010" }] }));
  assert.equal(withRows.ok, true);

  const synthetic = parseDryRunJsonPayload(JSON.stringify({ useSynthetic: true }));
  assert.equal(synthetic.ok, true);
});

test("parseDryRunJsonPayload fails closed on empty text, invalid JSON, or empty arrays", () => {
  assert.equal(parseDryRunJsonPayload("   ").ok, false);
  assert.equal(parseDryRunJsonPayload("{broken").ok, false);
  assert.equal(parseDryRunJsonPayload("[]").ok, false);
  assert.equal(parseDryRunJsonPayload(JSON.stringify({ accounts: "bad" })).ok, false);
  assert.equal(parseDryRunJsonPayload(JSON.stringify({ accounts: [], parties: [] })).ok, false);
});

test("summarizeDryRunGate reflects ready vs blocked state and rolledBack invariant", () => {
  const okGate = summarizeDryRunGate(makeSampleReport());
  assert.equal(okGate.canProceedToCommit, true);
  assert.equal(okGate.blockerCount, 0);

  const blockedGate = summarizeDryRunGate(
    makeSampleReport({
      readyToCommit: false,
      blockersFa: ["تراز افتتاحیه متوازن نیست."],
      warningsFa: ["۱ کد ملی تکراری وجود دارد."],
    }),
  );
  assert.equal(blockedGate.canProceedToCommit, false);
  assert.equal(blockedGate.blockerCount, 1);
  assert.equal(blockedGate.warningCount, 1);
});

test("reason and source formatters return Persian labels for every known enum variant", () => {
  assert.ok(unmappedReasonLabel("missing_in_chart").length > 0);
  assert.ok(unmappedReasonLabel("non_postable_level").length > 0);
  assert.ok(unmappedReasonLabel("floating_detail_only").length > 0);
  assert.ok(unmappedReasonLabel("has_child_accounts").length > 0);

  assert.ok(duplicateReasonLabel("duplicate_code_in_batch").length > 0);
  assert.ok(duplicateReasonLabel("duplicate_national_id_in_batch").length > 0);
  assert.ok(duplicateReasonLabel("existing_code_in_db").length > 0);
  assert.ok(duplicateReasonLabel("existing_national_id_in_db").length > 0);

  assert.ok(sourceDisplayLabel("sepidar").includes("سپیدار"));
  assert.ok(sourceDisplayLabel("holoo").includes("هلو"));
});
