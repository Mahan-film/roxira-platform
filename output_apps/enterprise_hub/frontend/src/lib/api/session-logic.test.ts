// Run: node --test src/lib/api/session-logic.test.ts   (Node 22.18+ strips types natively)
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REFRESH_LEAD_MS,
  accessNeedsRefresh,
  canRefresh,
  isSessionAlive,
  msUntilRefresh,
} from "./session-logic.ts";

const NOW = 1_000_000_000_000;
const base = { accessToken: "a.b.c", expiresAt: NOW + 15 * 60_000 };

test("a fresh access token is alive and needs no refresh yet", () => {
  assert.equal(isSessionAlive(base, NOW), true);
  assert.equal(accessNeedsRefresh(base, NOW), false);
});

test("refresh starts one minute before expiry", () => {
  const nearEnd = { ...base, expiresAt: NOW + REFRESH_LEAD_MS - 1 };
  assert.equal(accessNeedsRefresh(nearEnd, NOW), true);
  assert.equal(msUntilRefresh(base, NOW), 14 * 60_000);
  assert.equal(msUntilRefresh(nearEnd, NOW), 5_000);
});

test("an expired access token with a live refresh token stays signed in", () => {
  const session = { ...base, expiresAt: NOW - 1, refreshToken: "r", refreshExpiresAt: NOW + 86_400_000 };
  assert.equal(canRefresh(session, NOW), true);
  assert.equal(isSessionAlive(session, NOW), true);
});

test("an expired access token without a refresh token ends the session (Smart Judge)", () => {
  assert.equal(isSessionAlive({ ...base, expiresAt: NOW - 1 }, NOW), false);
});

test("an expired refresh token ends the session", () => {
  const session = { ...base, expiresAt: NOW - 1, refreshToken: "r", refreshExpiresAt: NOW - 1 };
  assert.equal(canRefresh(session, NOW), false);
  assert.equal(isSessionAlive(session, NOW), false);
});
