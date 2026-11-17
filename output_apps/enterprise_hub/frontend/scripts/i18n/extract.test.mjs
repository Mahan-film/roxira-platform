import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runCodemod } from './extract.mjs';

test('i18n extraction codemod', async (t) => {
  const tmpDir = path.resolve(process.cwd(), 'src/components/__test_i18n_tmp__');
  const tmpLocaleDir = path.resolve(process.cwd(), '__test_messages_tmp__');

  fs.mkdirSync(tmpDir, { recursive: true });

  const fixtureCode = `"use client";

import React from "react";

export function TestWidget() {
  const handleClick = () => {
    toast.success("اطلاعات ذخیره شد");
  };

  return (
    <div title="راهنمای سیستم">
      <input placeholder="جستجوی پیشرفته..." aria-label="ورودی متن" />
      <button onClick={handleClick}>
        ثبت درخواست جدید
      </button>
    </div>
  );
}
`;

  const fixtureFile = path.join(tmpDir, 'test-widget.tsx');
  fs.writeFileSync(fixtureFile, fixtureCode, 'utf8');

  try {
    await t.test('dry-run reports counts without altering files', async () => {
      const result = await runCodemod({
        targetDir: tmpDir,
        dryRun: true,
        localeDir: tmpLocaleDir,
      });

      assert.equal(result.totalExtracted, 5); // toast + title + placeholder + aria-label + button text
      assert.equal(result.summary.length, 1);
      assert.equal(result.summary[0].count, 5);

      // Verify file was NOT modified
      const code = fs.readFileSync(fixtureFile, 'utf8');
      assert.equal(code, fixtureCode);
    });

    await t.test('active extraction wraps literals and creates catalogue', async () => {
      const result = await runCodemod({
        targetDir: tmpDir,
        dryRun: false,
        localeDir: tmpLocaleDir,
      });

      assert.equal(result.totalExtracted, 5);

      // Verify file was modified
      const modifiedCode = fs.readFileSync(fixtureFile, 'utf8');
      assert.ok(modifiedCode.includes('useTranslations'));
      assert.ok(modifiedCode.includes('t(\'test-widget.'));

      // Verify catalogue was created
      const faCataloguePath = path.join(tmpLocaleDir, 'fa', '__test_i18n_tmp__.json');
      assert.ok(fs.existsSync(faCataloguePath));

      const faData = JSON.parse(fs.readFileSync(faCataloguePath, 'utf8'));
      assert.ok(faData['test-widget']);
      const keys = Object.keys(faData['test-widget']);
      assert.equal(keys.length, 5);
    });
  } finally {
    // Clean up
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpLocaleDir, { recursive: true, force: true });
  }
});
