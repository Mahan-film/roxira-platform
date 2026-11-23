import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { API_SCOPES, SCOPE_LABELS_FA } from "../types/api-tokens.ts";

const apiTokensPagePath = fileURLToPath(
  new URL("../app/app/settings/api-tokens/page.tsx", import.meta.url),
);
const apiTokensClientPath = fileURLToPath(
  new URL("./api/api-tokens-client.ts", import.meta.url),
);

test("api scopes defined with valid Persian labels and descriptions", () => {
  assert.equal(API_SCOPES.length, 5);
  for (const scope of API_SCOPES) {
    const info = SCOPE_LABELS_FA[scope];
    assert.ok(info, `Missing label info for scope: ${scope}`);
    assert.ok(info.label.length > 0, `Empty label for scope: ${scope}`);
    assert.ok(info.description.length > 0, `Empty description for scope: ${scope}`);
    assert.ok(!/[A-Za-z]/.test(info.label), `Label must not contain Latin letters: ${info.label}`);
  }
});

test("tokens are never logged and never shown twice", () => {
  const pageSource = readFileSync(apiTokensPagePath, "utf8");
  const clientSource = readFileSync(apiTokensClientPath, "utf8");

  // بررسی عدم وجود هرگونه دستور لاگ کردن توکن در کلاینت یا صفحه
  assert.ok(!pageSource.includes("console.log"), "api-tokens page must not log anything to console");
  assert.ok(!pageSource.includes("console.info"), "api-tokens page must not log info to console");
  assert.ok(!clientSource.includes("console.log"), "api-tokens client must not log anything to console");

  // بررسی وجود مکانیسم پاک‌سازی و نمایش یک‌باره در صفحه
  assert.ok(
    pageSource.includes("setNewlyCreatedToken(null)"),
    "Page must provide a mechanism to dismiss and clear the revealed token from state",
  );
  assert.ok(
    pageSource.includes("این کلید فقط همین یک‌بار نمایش داده می‌شود"),
    "Page must display the one-time warning notice to the user",
  );
});
