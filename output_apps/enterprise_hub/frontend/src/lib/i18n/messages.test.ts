import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getMessages, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './messages.ts';

test('i18n messages loader', async (t) => {
  await t.test('default locale is fa', () => {
    assert.equal(DEFAULT_LOCALE, 'fa');
    assert.deepEqual(SUPPORTED_LOCALES, ['fa', 'en']);
  });

  await t.test('loads messages and falls back from en to fa for missing keys', () => {
    const root = path.resolve(process.cwd(), 'messages');
    const faDir = path.join(root, 'fa');
    const enDir = path.join(root, 'en');

    fs.mkdirSync(faDir, { recursive: true });
    fs.mkdirSync(enDir, { recursive: true });

    // Write fixture catalogues
    const faContent = {
      testComp: {
        key1: 'سلام',
        key2: 'خوش آمدید',
      },
    };
    const enContent = {
      testComp: {
        key1: 'Hello',
        // key2 is intentionally missing to verify fallback
      },
    };

    fs.writeFileSync(path.join(faDir, 'test_ns.json'), JSON.stringify(faContent));
    fs.writeFileSync(path.join(enDir, 'test_ns.json'), JSON.stringify(enContent));

    try {
      const faMessages = getMessages('fa');
      assert.equal(faMessages.test_ns.testComp.key1, 'سلام');
      assert.equal(faMessages.test_ns.testComp.key2, 'خوش آمدید');

      const enMessages = getMessages('en');
      assert.equal(enMessages.test_ns.testComp.key1, 'Hello');
      // key2 falls back to Persian:
      assert.equal(enMessages.test_ns.testComp.key2, 'خوش آمدید');
    } finally {
      // Clean up test files
      if (fs.existsSync(path.join(faDir, 'test_ns.json'))) fs.unlinkSync(path.join(faDir, 'test_ns.json'));
      if (fs.existsSync(path.join(enDir, 'test_ns.json'))) fs.unlinkSync(path.join(enDir, 'test_ns.json'));
    }
  });
});
