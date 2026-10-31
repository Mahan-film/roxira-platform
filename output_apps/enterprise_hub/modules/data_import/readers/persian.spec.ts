import { decodeText } from './persian/text-decode';
import { detectMoneyUnit } from './persian/money-unit';
import { detectDateSystem } from './persian/date-system';
import { analyseScript } from './persian/script-report';
import { parseJalaliDate } from '../normaliser/normalise';

describe('encoding', () => {
  it('UTF-8 stays UTF-8', () => {
    expect(decodeText(Buffer.from('صندوق', 'utf8')).encoding).toBe('utf-8');
  });
  it('Windows-1256 bytes decode to Persian', () => {
    const bytes = Buffer.from([0xd5, 0xe4, 0xcf, 0xe6, 0xdc]); // صندوق-like (cp1256)
    const out = decodeText(Buffer.concat([bytes, Buffer.from(' '), bytes, Buffer.from(' '), bytes, Buffer.from(' '), bytes]));
    expect(out.encoding).toBe('windows-1256');
    expect(out.text).toMatch(/^[؀-ۿ‌ ]+$/);
  });
  it('UTF-16BE with BOM', () => {
    const b = Buffer.from('﻿اب', 'utf16le');
    b.swap16();
    expect(decodeText(b).text).toBe('اب');
  });
});

describe('rial vs toman', () => {
  it.each([
    ['مبلغ (ریال)', 'rial', 1],
    ['مبلغ تومان', 'toman', 10],
    ['Amount IRT', 'toman', 10],
    ['Amount IRR', 'rial', 1],
    ['مبلغ (هزار ریال)', 'rial', 1000],
    ['مبلغ (میلیون تومان)', 'toman', 10_000_000],
    ['مبلغ', 'unknown', null],
  ])('%s → %s', (header, unit, toRial) => {
    const g = detectMoneyUnit(header as string);
    expect(g.unit).toBe(unit);
    expect(g.toRial).toBe(toRial);
  });
  it('units written inside the cells are used, never guessed from magnitude', () => {
    expect(detectMoneyUnit('مبلغ', ['۱۲٬۰۰۰ تومان', '۵۰۰ تومان']).unit).toBe('toman');
    expect(detectMoneyUnit('مبلغ', ['12000000', '500000']).unit).toBe('unknown');
  });
});

describe('Jalali vs Gregorian', () => {
  it('detects by year', () => {
    expect(detectDateSystem(['1403/07/15', '۱۴۰۳-۰۸-۰۱']).system).toBe('jalali');
    expect(detectDateSystem(['2024-10-06', '06/10/2024']).system).toBe('gregorian');
    expect(detectDateSystem(['1403/07/15', '2024-10-06']).system).toBe('mixed');
  });
  it('day-first Jalali and month names are understood', () => {
    expect(parseJalaliDate('15/07/1403')).toBe('2024-10-06');
    expect(parseJalaliDate('۱۵ مهر ۱۴۰۳')).toBe('2024-10-06');
    expect(parseJalaliDate('1403/07/15')).toBe('2024-10-06');
  });
});

describe('Arabic vs Persian letters', () => {
  it('reports mixed use', () => {
    const r = analyseScript(['كتاب کتاب', 'علي علی ٣ ۳ 3']);
    expect(r.mixedLetters).toBe(true);
    expect(r.arabicKaf).toBe(1);
    expect(r.persianKaf).toBe(1);
    expect(r.arabicIndicDigits).toBe(1);
    expect(r.persianDigits).toBe(1);
    expect(r.asciiDigits).toBe(1);
  });
});
