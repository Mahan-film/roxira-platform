import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const TAX_PAGES = [
  "src/app/app/tax/page.tsx",
  "src/app/app/tax/electronic-books/page.tsx",
  "src/app/app/tax/kartable/page.tsx",
  "src/app/app/tax/previews/page.tsx",
  "src/app/app/tax/wizard/page.tsx",
];

const BASE_DIR = process.cwd();

test("tax pages: all 5 compliance pages exist", () => {
  for (const relPath of TAX_PAGES) {
    const fullPath = path.join(BASE_DIR, relPath);
    assert.ok(fs.existsSync(fullPath), `Tax page must exist: ${relPath}`);
  }
});

test("tax pages: zero physical layout classes (bidirectional logical classes enforced)", () => {
  const physicalRegex = /\b(ml-\d|mr-\d|pl-\d|pr-\d|text-left|text-right)\b/g;

  for (const relPath of TAX_PAGES) {
    const fullPath = path.join(BASE_DIR, relPath);
    const content = fs.readFileSync(fullPath, "utf8");
    const matches = content.match(physicalRegex) || [];
    assert.deepEqual(
      matches,
      [],
      `Found physical layout classes in ${relPath}: ${matches.join(", ")}. Use logical classes (ms, me, ps, pe, text-start, text-end).`,
    );
  }
});

test("tax pages: interactive controls meet 44px minimum touch target guidelines", () => {
  for (const relPath of TAX_PAGES) {
    const fullPath = path.join(BASE_DIR, relPath);
    const content = fs.readFileSync(fullPath, "utf8");

    // All tab buttons must include min-h-[44px]
    if (content.includes('role="tab"')) {
      const tabMatches = content.match(/<Button[^>]*role="tab"[^>]*>/g) || [];
      for (const tabTag of tabMatches) {
        assert.ok(
          tabTag.includes("min-h-[44px]"),
          `Tab in ${relPath} missing min-h-[44px]: ${tabTag}`,
        );
      }
    }

    // Interactive button triggers for search, action, submit must not use bare sub-44px size="sm" without min-h-[44px]
    const smallButtonsWithoutMinHeight = content.match(
      /<Button[^>]*size="sm"(?![^>]*min-h-\[44px\])[^>]*>/g,
    );
    assert.equal(
      smallButtonsWithoutMinHeight,
      null,
      `Found size="sm" button without min-h-[44px] in ${relPath}: ${JSON.stringify(smallButtonsWithoutMinHeight)}`,
    );
  }
});

test("tax pages: form inputs and selects have accessible names or labels", () => {
  for (const relPath of TAX_PAGES) {
    const fullPath = path.join(BASE_DIR, relPath);
    const content = fs.readFileSync(fullPath, "utf8");

    // Check raw <input> elements (excluding hidden or checkbox with adjacent label)
    const rawInputs = content.match(/<input\b[^>]*>/g) || [];
    for (const inputTag of rawInputs) {
      if (inputTag.includes('type="checkbox"') || inputTag.includes('type="hidden"')) continue;
      const hasAccessibleName =
        inputTag.includes("aria-label=") ||
        inputTag.includes("id=") ||
        inputTag.includes("placeholder=");
      assert.ok(
        hasAccessibleName,
        `Input in ${relPath} missing accessible identifier (aria-label, id, or placeholder): ${inputTag}`,
      );
    }

    // Check <select> elements
    const rawSelects = content.match(/<select\b[^>]*>/g) || [];
    for (const selectTag of rawSelects) {
      const hasAccessibleName =
        selectTag.includes("aria-label=") || selectTag.includes("id=");
      assert.ok(
        hasAccessibleName,
        `Select in ${relPath} missing accessible identifier (aria-label or id): ${selectTag}`,
      );
    }
  }
});

test("tax pages: tables are protected with horizontal overflow containers for 375px mobile viewports", () => {
  for (const relPath of TAX_PAGES) {
    const fullPath = path.join(BASE_DIR, relPath);
    const content = fs.readFileSync(fullPath, "utf8");

    if (content.includes("<Table>")) {
      // Must contain an overflow-x-auto container wrapper or Table container with overflow
      assert.ok(
        content.includes("overflow-x-auto"),
        `${relPath} uses <Table> but lacks overflow-x-auto container protection for phone viewports`,
      );
    }
  }
});
