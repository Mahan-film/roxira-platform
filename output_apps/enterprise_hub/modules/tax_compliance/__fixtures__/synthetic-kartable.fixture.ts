import { strToU8, zipSync } from 'fflate';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function colLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/**
 * ساخت بافر XLSX مصنوعی حداقل برای آزمون‌های کارپوشه (با کتابخانه فلت `fflate`).
 */
export function buildSyntheticXlsxBuffer(
  headers: string[],
  rows: Array<Array<string | number>>,
): Buffer {
  const allRows: Array<Array<string | number>> = [headers, ...rows];
  const rowXml = allRows
    .map((cells, rIdx) => {
      const r = rIdx + 1;
      const cellXml = cells
        .map((val, cIdx) => {
          const ref = `${colLetter(cIdx)}${r}`;
          if (typeof val === 'number') {
            return `<c r="${ref}"><v>${val}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(val))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}">${cellXml}</row>`;
    })
    .join('');

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="کارپوشه" sheetId="1" r:id="rId1"/></sheets>' +
    '</workbook>';

  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  const sheet1 =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowXml}</sheetData>` +
    '</worksheet>';

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(wbRels),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
  });
  return Buffer.from(zipped);
}

/**
 * فایل CSV مصنوعی فروش کارپوشه مودیان (فصل ۱ سال ۱۴۰۵ + یک سطر فصل ۲ جهت تست فیلتر فصل).
 */
export const SYNTHETIC_KARTABLE_SALES_CSV = Buffer.from(
  '\uFEFF' +
    [
      'شماره منحصر به فرد مالیاتی,شماره صورتحساب,تاریخ صدور,نام خریدار,شناسه ملی,مبلغ مشمول مالیات,مالیات بر ارزش افزوده,مجموع مبلغ صورتحساب',
      // 1. Matched by TaxID (1405-01-15 -> Q1)
      'TAX-SYNTH-0000000001,INV-1405-001,۱۴۰۵/۰۱/۱۵,شرکت نمونه الف,10101010101,"10,000,000 ریال","1,000,000 ریال","11,000,000 ریال"',
      // 2. Matched by InvoiceNumber, VAT mismatch (1405-02-10 -> Q1)
      ',INV-1405-002,1405/02/10,بازرگانی نمونه ب,20202020202,5000000,450000,5450000',
      // 3. Matched uniquely by Amount (1405-03-01 -> Q1)
      'TAX-SYNTH-NEW-AMOUNT,,1405/03/01,فروشگاه نمونه ج,30303030303,2000000,200000,2200000',
      // 4. Missing in our system (exists in Kartable only, Q1)
      'TAX-SYNTH-ONLY-KART,INV-EXT-999,1405/03/20,مشتری کارپوشه‌ای,40404040404,3000000,300000,3300000',
      // 5. Out of period (1405/04/05 -> Q2), should be skipped for Q1
      'TAX-SYNTH-Q2-SKIP,INV-1405-Q2,1405/04/05,مشتری فصل دو,50505050505,9000000,900000,9900000',
    ].join('\n'),
  'utf8',
);

/**
 * فایل اکسل (XLSX) مصنوعی خرید کارپوشه مودیان با حروف عربی ي/ك جهت تست نرمال‌سازی.
 */
export const SYNTHETIC_KARTABLE_PURCHASES_XLSX = buildSyntheticXlsxBuffer(
  [
    'شماره منحصر به فرد مالياتي',
    'شماره فاكتور',
    'تاريخ صدور',
    'نام فروشنده',
    'مبلغ مشمول ماليات',
    'ماليات بر ارزش افزوده',
    'مجموع مبلغ صورتحساب',
  ],
  [
    ['PUR-TAX-001', 'PINV-101', '1405/01/25', 'تأمین‌کننده الف', 4000000, 400000, 4400000],
    ['PUR-TAX-ONLY-KART', 'PINV-999', '1405/02/12', 'تأمین‌کننده ب', 1000000, 100000, 1100000],
  ],
);
