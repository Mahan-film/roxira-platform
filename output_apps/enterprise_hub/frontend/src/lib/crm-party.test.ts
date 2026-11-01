import assert from "node:assert/strict";
import { test } from "node:test";

import { checkParty } from "./crm-party.ts";

test("plain person with a company is fine", () => {
  assert.equal(checkParty({ fullName: "علی رضایی", company: "شرکت الف" }).status, "ok");
});

test("«company - person» in one cell is repairable", () => {
  const r = checkParty({ fullName: "شرکت پارس - علی رضایی", company: null });
  assert.equal(r.status, "repairable");
  if (r.status === "repairable") {
    assert.deepEqual(r.fix, { company: "شرکت پارس", fullName: "علی رضایی" });
  }
});

test("company name alone is flagged, not guessed", () => {
  assert.equal(checkParty({ fullName: "شرکت پارس", company: null }).status, "review");
});

test("same text in both fields is flagged", () => {
  assert.equal(checkParty({ fullName: "علی", company: "علی" }).status, "review");
});

test("swapped fields are flagged", () => {
  assert.equal(checkParty({ fullName: "گروه صنعتی ب", company: "رضا احمدی" }).status, "review");
});
