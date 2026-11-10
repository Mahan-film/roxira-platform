// Run: node --test src/lib/api/session-logic.test.ts   (Node 22.18+ strips types natively)
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REFRESH_LEAD_MS,
  accessNeedsRefresh,
  canRefresh,
  hasActiveTenant,
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

function mockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("hasActiveTenant returns false for empty, null or invalid tokens", () => {
  assert.equal(hasActiveTenant(null), false);
  assert.equal(hasActiveTenant(undefined), false);
  assert.equal(hasActiveTenant(""), false);
  assert.equal(hasActiveTenant("not-a-jwt"), false);
  assert.equal(hasActiveTenant("part1.part2"), false);
});

test("hasActiveTenant returns false when tenantId is null (user signed up without org)", () => {
  const jwt = mockJwt({ sub: "user-1", email: "noorg@example.invalid", tenantId: null });
  assert.equal(hasActiveTenant(jwt), false);
});

test("hasActiveTenant returns false when tenantId is empty string or whitespace", () => {
  const jwt = mockJwt({ sub: "user-1", tenantId: "   " });
  assert.equal(hasActiveTenant(jwt), false);
});

test("hasActiveTenant returns true when tenantId is a valid non-empty string", () => {
  const jwt = mockJwt({ sub: "user-1", tenantId: "d6e30a13-c126-46d9-9ca8-e3489ac370a4" });
  assert.equal(hasActiveTenant(jwt), true);
});
