import { parseCamt053 } from './camt053.parser';
import { parseMt940 } from './mt940.parser';
import { ParsedStatement, StatementFormat, StatementParseError } from './statement.types';

/** CAMT.053 files start with XML; MT940 messages with a `:20:` field (optionally after SWIFT block headers). */
export function detectFormat(content: string): StatementFormat {
  const head = content.replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) return 'camt053';
  if (/(^|\n)\s*:20:/.test(head.slice(0, 4000)) || head.startsWith('{1:')) return 'mt940';
  throw new StatementParseError('Unrecognised statement: expected CAMT.053 XML or an MT940 message.');
}

export function parseStatement(content: string, format?: StatementFormat): ParsedStatement {
  const text = content.replace(/^﻿/, '');
  const chosen = format ?? detectFormat(text);
  return chosen === 'camt053' ? parseCamt053(text) : parseMt940(text);
}
