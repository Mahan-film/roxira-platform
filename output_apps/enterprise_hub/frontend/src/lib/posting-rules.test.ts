import assert from "node:assert/strict";
import { test } from "node:test";

import { accountsForRole } from "./posting-rules.ts";

const accounts = [
  { code: "1", level: "GROUP", accountType: "ASSET" },
  { code: "10", level: "KOL", accountType: "ASSET" },
  { code: "1012", level: "MOEIN", accountType: "ASSET" },
  { code: "2010", level: "MOEIN", accountType: "LIABILITY" },
  { code: "9999", level: null, accountType: "ASSET" },
];

test("accountsForRole keeps only posting-level accounts of an allowed type", () => {
  assert.deepEqual(accountsForRole(accounts, ["ASSET"]).map((a) => a.code), ["1012", "9999"]);
  assert.deepEqual(accountsForRole(accounts, ["LIABILITY"]).map((a) => a.code), ["2010"]);
});
