#!/usr/bin/env node
/**
 * Deterministic generator for the fictional Iranian trading company fixture:
 * «شرکت بازرگانی سپهر البرز نمونه (سهامی خاص)»
 *
 * All people, companies, phone numbers, national/economic IDs, emails, and
 * bank references are synthetic test values. Running this script multiple
 * times from the fixed seed produces byte-for-byte identical CSV, Windows-1256
 * CSV, XLSX, and README files.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const SEED = 14030701;

/** Mulberry32 deterministic PRNG. */
function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function toPersianDigits(str) {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(str).replace(/\d/g, (d) => map[Number(d)]);
}

function toArabicDigits(str) {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(str).replace(/\d/g, (d) => map[Number(d)]);
}

function toArabicYeKaf(str) {
  return String(str).replace(/ی/g, 'ي').replace(/ک/g, 'ك');
}

/* -------------------------- Deterministic ZIP/XLSX ------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  // Fixed DOS date/time (2024-03-20 00:00:00) for deterministic output
  const dosTime = 0x0000;
  const dosDate = ((2024 - 1980) << 9) | (3 << 5) | 20;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(dataBuf);
    const utf8Flag = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(utf8Flag, 6);
    local.writeUInt16LE(0, 8); // Method 0: STORE (uncompressed for cross-Node byte-for-byte determinism)
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(utf8Flag, 8);
    central.writeUInt16LE(0, 10); // Method 0: STORE (uncompressed)
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colLetter(colIdx) {
  let n = colIdx + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function buildXlsxWorkbook(sheets) {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

  const stringIndex = new Map();
  const sharedStrings = [];
  let totalStringCount = 0;

  function internString(val) {
    totalStringCount += 1;
    const key = String(val);
    let idx = stringIndex.get(key);
    if (idx === undefined) {
      idx = sharedStrings.length;
      stringIndex.set(key, idx);
      sharedStrings.push(key);
    }
    return idx;
  }

  const sheetFiles = sheets.map((sheet, idx) => {
    const allRows = [sheet.headers, ...sheet.rows];
    const rowXml = allRows
      .map((row, rIdx) => {
        const rowNum = rIdx + 1;
        const cells = row
          .map((cell, cIdx) => {
            if (cell === null || cell === undefined || cell === '') {
              return '';
            }
            const ref = `${colLetter(cIdx)}${rowNum}`;
            if (typeof cell === 'number' && Number.isFinite(cell)) {
              return `<c r="${ref}"><v>${cell}</v></c>`;
            }
            const sIdx = internString(String(cell));
            return `<c r="${ref}" t="s"><v>${sIdx}</v></c>`;
          })
          .filter(Boolean)
          .join('');
        return `<row r="${rowNum}">${cells}</row>`;
      })
      .join('');
    return {
      name: `xl/worksheets/sheet${idx + 1}.xml`,
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${rowXml}</sheetData></worksheet>`,
        'utf8',
      ),
    };
  });

  const sstItems = sharedStrings
    .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
    .join('');
  const sharedStringsXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${NS}" count="${totalStringCount}" uniqueCount="${sharedStrings.length}">${sstItems}</sst>`,
    'utf8',
  );

  const workbookSheets = sheets
    .map(
      (s, idx) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`,
    )
    .join('');
  const workbookXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL_NS}"><sheets>${workbookSheets}</sheets></workbook>`,
    'utf8',
  );

  const wbRels = sheets
    .map(
      (_s, idx) =>
        `<Relationship Id="rId${idx + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`,
    )
    .concat([
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`,
    ])
    .join('');
  const workbookRelsXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL_NS}">${wbRels}</Relationships>`,
    'utf8',
  );

  const rootRelsXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'utf8',
  );

  const sheetOverrides = sheets
    .map(
      (_s, idx) =>
        `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  const contentTypesXml = Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      sheetOverrides +
      '</Types>',
    'utf8',
  );

  return makeZip([
    { name: '[Content_Types].xml', data: contentTypesXml },
    { name: '_rels/.rels', data: rootRelsXml },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml },
    ...sheetFiles,
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml },
  ]);
}

/* -------------------------- CSV & Windows-1256 ----------------------------- */

function toCsvText(headers, rows) {
  const formatCell = (cell) => {
    const s = cell === null || cell === undefined ? '' : String(cell);
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(formatCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(formatCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function encodeWindows1256(str) {
  const decoder = new TextDecoder('windows-1256');
  const charToByte = new Map();
  for (let b = 0; b < 256; b += 1) {
    const ch = decoder.decode(Uint8Array.of(b));
    if (!charToByte.has(ch)) {
      charToByte.set(ch, b);
    }
  }
  // Map Persian Yeh (ی U+06CC) and Keheh (ک U+06A9) to Windows-1256 Arabic Yeh (0xED) and Kaf (0xDF)
  charToByte.set('ی', 0xed);
  charToByte.set('ي', 0xed);
  charToByte.set('ک', 0xdf);
  charToByte.set('ك', 0xdf);
  charToByte.set('پ', 0x81);
  charToByte.set('چ', 0x8d);
  charToByte.set('ژ', 0x8e);
  charToByte.set('گ', 0x90);
  charToByte.set('\u200c', 0x9d); // ZWNJ

  const PersianDigitToAscii = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };

  const bytes = [];
  for (const ch of str) {
    const mapped = PersianDigitToAscii[ch] ?? ch;
    const b = charToByte.get(mapped);
    if (b !== undefined) {
      bytes.push(b);
    } else if (mapped.charCodeAt(0) < 128) {
      bytes.push(mapped.charCodeAt(0));
    } else {
      bytes.push(0x3f); // '?'
    }
  }
  return Buffer.from(bytes);
}

/* -------------------------- Data Generation -------------------------------- */

function generateDataset() {
  const rng = createRng(SEED);

  // 1. Chart of Accounts (18 accounts)
  const chartOfAccountsHeaders = ['کد حساب', 'نام حساب', 'ماهیت حساب', 'واحد پول'];
  const chartOfAccountsRows = [
    ['1101', 'بانک ملت - جاری ریالی نمونه', 'دارایی', 'IRR'],
    ['1102', 'تنخواه گردان ریالی', 'دارایی', 'IRR'],
    ['1110', 'اسناد دریافتنی نزد صندوق', 'دارایی', 'IRR'],
    ['1120', 'اسناد دریافتنی در جریان وصول', 'دارایی', 'IRR'],
    ['1201', 'حساب‌های دریافتنی تجاری', 'دارایی', 'IRR'],
    ['1301', 'موجودی کالای بازرگانی', 'دارایی', 'IRR'],
    ['1401', 'پیش‌پرداخت خرید و اجاره', 'دارایی', 'IRR'],
    ['1501', 'اثاثه، تجهیزات و وسایل نقلیه', 'دارایی', 'IRR'],
    ['2101', 'حساب‌های پرداختنی تجاری', 'بدهی', 'IRR'],
    ['2110', 'اسناد پرداختنی تجاری', 'بدهی', 'IRR'],
    ['2201', 'مالیات بر ارزش افزوده پرداختنی', 'بدهی', 'IRR'],
    ['2301', 'ذخیره مالیات و بیمه پرداختنی', 'بدهی', 'IRR'],
    ['3101', 'سرمایه ثبت‌شده', 'سرمایه', 'IRR'],
    ['3201', 'اندوخته قانونی', 'سرمایه', 'IRR'],
    ['3301', 'سود (زیان) انباشته', 'سرمایه', 'IRR'],
    ['4101', 'فروش کالای بازرگانی', 'درآمد', 'IRR'],
    ['5101', 'بهای تمام‌شده کالای فروش‌رفته', 'هزینه', 'IRR'],
    ['6101', 'هزینه‌های حقوق، اداری و توزیع', 'هزینه', 'IRR'],
  ];

  // 2. 300 Inventory Items
  const categories = [
    'شیرآلات صنعتی',
    'اتصالات فولادی',
    'لوله پلی‌اتیلن',
    'پمپ سانتریفیوژ',
    'الکتروموتور سه‌فاز',
    'کابل افشان صنعتی',
    'تابلو برق فرمان',
    'سنسور فشار و دما',
    'فیلتر هیدرولیک',
    'بلبرینگ و یاتاقان',
  ];
  const specs = [
    'مدل A10', 'مدل B20', 'مدل C30', 'سری صنعتی ۱ اینچ', 'سری صنعتی ۲ اینچ',
    'فشار قوی PN16', 'فشار قوی PN25', 'استاندارد DIN', 'نسل سوم بهینه', 'مقاوم حرارتی',
  ];

  const itemsHeaders = [
    'کد کالا',
    'بارکد',
    'نام کالا',
    'موجودی',
    'حداقل موجودی',
    'بهای واحد (ریال)',
    'ارزش موجودی (ریال)',
    'شماره دسته',
  ];
  const itemsRows = [];
  const itemsData = [];
  let totalStockValue = 0;

  for (let i = 1; i <= 300; i += 1) {
    const sku = `ITM-${String(1000 + i)}`;
    const barcode = `626000099${String(1000 + i)}`;
    const cat = categories[(i - 1) % categories.length];
    const spec = specs[Math.floor((i - 1) / categories.length) % specs.length];
    let name = `${cat} ${spec} کد ${i}`;
    // Introduce Arabic ye/kaf on a subset of items (messy variant)
    if (i % 17 === 0) {
      name = toArabicYeKaf(name);
    }
    const quantity = randInt(rng, 10, 120);
    const minQuantity = randInt(rng, 5, 25);
    const unitCost = randInt(rng, 15, 250) * 100000; // 1,500,000 to 25,000,000 IRR
    const stockValue = quantity * unitCost;
    totalStockValue += stockValue;
    const batchNumber = `LOT-1403-${String(((i - 1) % 24) + 1).padStart(2, '0')}`;

    const qtyCell = i % 23 === 0 ? toPersianDigits(quantity) : String(quantity);
    const minQtyCell = i % 29 === 0 ? toArabicDigits(minQuantity) : String(minQuantity);

    itemsData.push({ sku, barcode, name, quantity, minQuantity, unitCost, stockValue, batchNumber });
    itemsRows.push([
      sku,
      barcode,
      name,
      qtyCell,
      minQtyCell,
      String(unitCost),
      String(stockValue),
      batchNumber,
    ]);
  }

  // 3. Opening Balances (exact balance: totalOpeningDebit === totalOpeningCredit)
  const openingReceivables = 1840000000;
  const openingPayables = 1120000000;
  const openingCashBank = 2500000000;
  const openingPettyCash = 150000000;
  const openingNotesReceivable = 850000000;
  const openingPrepayments = 260000000;
  const openingEquipment = 1400000000;

  const totalOpeningDebit =
    openingCashBank +
    openingPettyCash +
    openingNotesReceivable +
    openingReceivables +
    totalStockValue +
    openingPrepayments +
    openingEquipment;

  const openingNotesPayable = 680000000;
  const openingVatPayable = 195000000;
  const openingTaxSsoPayable = 105000000;
  const openingCapital = 5000000000;
  const openingLegalReserve = 500000000;
  const openingRetainedEarnings =
    totalOpeningDebit -
    (openingPayables +
      openingNotesPayable +
      openingVatPayable +
      openingTaxSsoPayable +
      openingCapital +
      openingLegalReserve);

  const totalOpeningCredit =
    openingPayables +
    openingNotesPayable +
    openingVatPayable +
    openingTaxSsoPayable +
    openingCapital +
    openingLegalReserve +
    openingRetainedEarnings;

  if (totalOpeningDebit !== totalOpeningCredit) {
    throw new Error(`Opening balances do not balance: ${totalOpeningDebit} !== ${totalOpeningCredit}`);
  }

  const openingBalancesHeaders = [
    'کد حساب',
    'بدهکار (ریال)',
    'بستانکار (ریال)',
    'تاریخ',
    'شرح',
  ];
  const openingBalancesRows = [
    ['1101', String(openingCashBank), '0', '2024-03-20', 'مانده اول دوره بانک ملت جاری ریالی نمونه'],
    ['1102', String(openingPettyCash), '0', '2024-03-20', 'مانده اول دوره تنخواه گردان'],
    ['1110', String(openingNotesReceivable), '0', '2024-03-20', 'مانده اول دوره اسناد دریافتنی نزد صندوق'],
    ['1201', String(openingReceivables), '0', '2024-03-20', 'مانده اول دوره حساب‌های دریافتنی تجاری'],
    ['1301', String(totalStockValue), '0', '2024-03-20', 'مانده اول دوره موجودی کالای بازرگانی (۳۰۰ قلم)'],
    ['1401', String(openingPrepayments), '0', '2024-03-20', 'مانده اول دوره پیش‌پرداخت خرید و اجاره'],
    ['1501', String(openingEquipment), '0', '2024-03-20', 'مانده اول دوره اثاثه و تجهیزات'],
    ['2101', '0', String(openingPayables), '2024-03-20', 'مانده اول دوره حساب‌های پرداختنی تجاری'],
    ['2110', '0', String(openingNotesPayable), '2024-03-20', 'مانده اول دوره اسناد پرداختنی تجاری'],
    ['2201', '0', String(openingVatPayable), '2024-03-20', 'مانده اول دوره مالیات بر ارزش افزوده پرداختنی'],
    ['2301', '0', String(openingTaxSsoPayable), '2024-03-20', 'مانده اول دوره ذخیره مالیات و بیمه'],
    ['3101', '0', String(openingCapital), '2024-03-20', 'مانده اول دوره سرمایه ثبت‌شده'],
    ['3201', '0', String(openingLegalReserve), '2024-03-20', 'مانده اول دوره اندوخته قانونی'],
    ['3301', '0', String(openingRetainedEarnings), '2024-03-20', 'مانده اول دوره سود انباشته'],
  ];

  // 4. 50 Customers (30) and Suppliers (20) — fictional names, synthetic test IDs/phones
  const firstNames = [
    'آرش', 'بهرام', 'پیمان', 'تورج', 'جواد', 'حامد', 'خسرو', 'داراب', 'رامین', 'سهراب',
    'شهاب', 'طاها', 'عرفان', 'فرهاد', 'قباد', 'کامران', 'مازیار', 'نادر', 'هومن', 'یاسر',
  ];
  const lastNames = [
    'آذرخش نمونه', 'بهمنی آزمایشی', 'پاکزاد فرضی', 'ابراهیمی تست', 'جلالی نمونه',
    'حکیمی فرضی', 'خرمی آزمایشی', 'داوری نمونه', 'رادمنش تست', 'سروش فرضی',
  ];
  const companyPrefixes = [
    'بازرگانی سپیده', 'تجهیز صنعت', 'پخش قطعات', 'فولاد گستر', 'الکترو پیشرو',
    'ماشین‌سازی نوین', 'پلیمر سازان', 'تأمین صنعت', 'آبرسان دشت', 'نیرو صنعت',
  ];

  const counterpartiesHeaders = [
    'کد طرف حساب',
    'نقش',
    'نام و نام خانوادگی',
    'شرکت',
    'رایانامه',
    'تلفن',
    'شناسه ملی / کد اقتصادی آزمایشی',
    'مرحله فروش',
    'ارزش برآوردی (ریال)',
    'توضیحات',
  ];
  const counterpartiesRows = [];
  const counterpartiesData = [];

  for (let i = 1; i <= 50; i += 1) {
    const isCustomer = i <= 30;
    const code = isCustomer
      ? `CUST-${String(i).padStart(3, '0')}`
      : `SUPP-${String(i - 30).padStart(3, '0')}`;
    const role = isCustomer ? 'مشتری' : 'تأمین‌کننده';
    const fn = firstNames[(i - 1) % firstNames.length];
    const ln = lastNames[Math.floor((i - 1) / 5) % lastNames.length];
    const compBase = `${companyPrefixes[(i - 1) % companyPrefixes.length]} الوند ${i} (آزمایشی)`;

    let fullName = `${fn} ${ln}`;
    let company = compBase;
    let phone = `09000000${String(100 + i)}`;
    let nationalId = `10000000${String(100 + i)}`;
    let email = `party${i}@example.invalid`;
    const estVal = (15 + (i % 20)) * 10000000;
    let estValStr = String(estVal);
    let notes = isCustomer ? 'مشتری آزمایشی فیکسچر تست' : 'تأمین‌کننده آزمایشی فیکسچر تست';

    // Messy variant 1: Persian digits in rows 5..8
    if (i >= 5 && i <= 8) {
      phone = toPersianDigits(phone);
      estValStr = toPersianDigits(estValStr);
    }
    // Messy variant 2: Arabic-Indic digits in rows 9..12
    if (i >= 9 && i <= 12) {
      phone = toArabicDigits(phone);
      estValStr = toArabicDigits(estValStr);
    }
    // Messy variant 3: Arabic ye (ي) and kaf (ك) in rows 13..18
    if (i >= 13 && i <= 18) {
      fullName = toArabicYeKaf(`${fullName} يكتا`);
      company = toArabicYeKaf(`${company} كيميا`);
      notes = toArabicYeKaf('نام با ي و ك عربي براي تست يكسان‌سازي');
    }
    // Messy variant 4: Merged name and company in rows 19..23 (company column left blank)
    if (i >= 19 && i <= 23) {
      fullName = `${fullName} - ${company}`;
      company = '';
      notes = 'نام شخص و نام شرکت در یک ستون ادغام شده است';
    }

    counterpartiesData.push({ code, isCustomer, fullName, company, email, phone, nationalId, estVal });
    counterpartiesRows.push([
      code,
      role,
      fullName,
      company,
      email,
      phone,
      nationalId,
      isCustomer ? 'واجد شرایط' : 'برنده شده',
      estValStr,
      notes,
    ]);
  }

  // Messy variant 5: Intentional duplicate rows inside customers-suppliers (row 30 duplicates row 1, row 50 duplicates row 31)
  counterpartiesRows[29] = [...counterpartiesRows[0]];
  counterpartiesRows[49] = [...counterpartiesRows[30]];

  // 5. 200 Sales and Purchase Invoices (120 sales + 80 purchases)
  const invoicesHeaders = [
    'شماره صورتحساب',
    'نوع صورتحساب',
    'تاریخ',
    'کد طرف حساب',
    'نام طرف حساب',
    'کد کالا',
    'تعداد',
    'بهای واحد (ریال)',
    'مبلغ',
    'مالیات ارزش افزوده',
    'جمع نهایی (ریال)',
    'ارز',
    'نرخ تسعیر',
    'وضعیت تسویه',
  ];
  const invoicesRows = [];
  let salesReceivablesDelta = 0;
  let purchasePayablesDelta = 0;
  let totalSalesGross = 0;
  let totalPurchasesGross = 0;

  for (let i = 1; i <= 200; i += 1) {
    const isSale = i <= 120;
    const invNum = isSale
      ? `INV-S-1403-${String(i).padStart(4, '0')}`
      : `INV-P-1403-${String(i - 120).padStart(4, '0')}`;
    const type = isSale ? 'فروش' : 'خرید';
    const month = String(((i - 1) % 6) + 4).padStart(2, '0');
    const day = String(((i - 1) % 25) + 1).padStart(2, '0');
    const date = `2024-${month}-${day}`;

    // Messy variant: Blank customer on walk-in/anonymous sales invoices (rows 111..116)
    const isBlankCustomer = isSale && i >= 111 && i <= 116;
    const partyIdx = isSale ? (i - 1) % 29 : 30 + ((i - 121) % 19);
    const party = counterpartiesData[partyIdx];
    const partyCode = isBlankCustomer ? '' : party.code;
    let partyName = isBlankCustomer ? '' : party.fullName;

    const item = itemsData[(i - 1) % itemsData.length];
    const qty = (i % 5) + 1;
    const unitPrice = isSale ? Math.round(item.unitCost * 1.25) : item.unitCost;
    const amount = qty * unitPrice;
    const vat = Math.round(amount * 0.1); // 10% VAT (1403 rate)
    const totalRial = amount + vat;
    const status = i % 3 === 0 ? 'تسویه‌شده' : 'صادرشده';

    if (i % 19 === 0 && partyName) {
      partyName = toArabicYeKaf(partyName);
    }

    const amountCell = i % 25 === 0 ? toPersianDigits(amount) : String(amount);
    const vatCell = i % 31 === 0 ? toArabicDigits(vat) : String(vat);

    invoicesRows.push([
      invNum,
      type,
      date,
      partyCode,
      partyName,
      item.sku,
      String(qty),
      String(unitPrice),
      amountCell,
      vatCell,
      String(totalRial),
      'IRR',
      '1',
      status,
    ]);

    if (isSale) {
      totalSalesGross += totalRial;
      if (status !== 'تسویه‌شده') {
        salesReceivablesDelta += totalRial;
      }
    } else {
      totalPurchasesGross += totalRial;
      if (status !== 'تسویه‌شده') {
        purchasePayablesDelta += totalRial;
      }
    }
  }

  // Intentional duplicate invoice rows: row 120 duplicates row 1, row 200 duplicates row 121
  const dupRow120OldTotal = Number(invoicesRows[119][10]);
  const dupRow120OldUnpaid = invoicesRows[119][13] !== 'تسویه‌شده' ? dupRow120OldTotal : 0;
  const dupRow1Total = Number(invoicesRows[0][10]);
  const dupRow1Unpaid = invoicesRows[0][13] !== 'تسویه‌شده' ? dupRow1Total : 0;
  salesReceivablesDelta = salesReceivablesDelta - dupRow120OldUnpaid + dupRow1Unpaid;
  totalSalesGross = totalSalesGross - dupRow120OldTotal + dupRow1Total;
  invoicesRows[119] = [...invoicesRows[0]];

  const dupRow200OldTotal = Number(invoicesRows[199][10]);
  const dupRow200OldUnpaid = invoicesRows[199][13] !== 'تسویه‌شده' ? dupRow200OldTotal : 0;
  const dupRow121Total = Number(invoicesRows[120][10]);
  const dupRow121Unpaid = invoicesRows[120][13] !== 'تسویه‌شده' ? dupRow121Total : 0;
  purchasePayablesDelta = purchasePayablesDelta - dupRow200OldUnpaid + dupRow121Unpaid;
  totalPurchasesGross = totalPurchasesGross - dupRow200OldTotal + dupRow121Total;
  invoicesRows[199] = [...invoicesRows[120]];

  let uniqueSalesReceivablesDelta = salesReceivablesDelta - dupRow1Unpaid;
  let uniquePurchasePayablesDelta = purchasePayablesDelta - dupRow121Unpaid;

  // 5b. 40 Multi-line Invoices (24 sales + 16 purchases) with 2 to 6 items each
  for (let m = 1; m <= 40; m += 1) {
    const isSale = m <= 24;
    const invNum = isSale
      ? `INV-S-1403-${String(120 + m).padStart(4, '0')}`
      : `INV-P-1403-${String(80 + (m - 24)).padStart(4, '0')}`;
    const type = isSale ? 'فروش' : 'خرید';
    const month = String(((m - 1) % 6) + 4).padStart(2, '0');
    const day = String(((m * 2) % 25) + 1).padStart(2, '0');
    const date = `2024-${month}-${day}`;

    const partyIdx = isSale ? (m - 1) % 29 : 30 + ((m - 25) % 19);
    const party = counterpartiesData[partyIdx];
    const partyCode = party.code;
    let partyName = party.fullName;

    const status = m % 3 === 0 ? 'تسویه‌شده' : 'صادرشده';
    const lineCount = 2 + ((m * 3 + 1) % 5); // 2 to 6 items per invoice (cycle of 6, 4, 2, 5, 3)

    for (let line = 0; line < lineCount; line += 1) {
      const itemIdx = (100 + m * 7 + line) % itemsData.length;
      const item = itemsData[itemIdx];
      const qty = ((m + line) % 5) + 1;
      const unitPrice = isSale ? Math.round(item.unitCost * 1.25) : item.unitCost;
      const amount = qty * unitPrice;
      const vat = Math.round(amount * 0.1); // 10% VAT
      const totalRial = amount + vat;

      invoicesRows.push([
        invNum,
        type,
        date,
        partyCode,
        partyName,
        item.sku,
        String(qty),
        String(unitPrice),
        String(amount),
        String(vat),
        String(totalRial),
        'IRR',
        '1',
        status,
      ]);

      if (isSale) {
        totalSalesGross += totalRial;
        if (status !== 'تسویه‌شده') {
          salesReceivablesDelta += totalRial;
          uniqueSalesReceivablesDelta += totalRial;
        }
      } else {
        totalPurchasesGross += totalRial;
        if (status !== 'تسویه‌شده') {
          purchasePayablesDelta += totalRial;
          uniquePurchasePayablesDelta += totalRial;
        }
      }
    }
  }

  // 6. 100 Bank Statement Lines
  const bankHeaders = [
    'تاریخ تراکنش',
    'زمان',
    'شرح',
    'برداشت (بدهکار)',
    'واریز (بستانکار)',
    'مانده',
    'شماره پیگیری',
    'شعبه',
  ];
  const bankRows = [];
  let runningBankBalance = openingCashBank;
  let totalBankDeposits = 0;
  let totalBankWithdrawals = 0;

  for (let i = 1; i <= 100; i += 1) {
    const month = String(((i - 1) % 6) + 4).padStart(2, '0');
    const day = String(((i - 1) % 27) + 1).padStart(2, '0');
    const date = `2024-${month}-${day}`;
    const hour = String(8 + (i % 9)).padStart(2, '0');
    const minute = String((i * 7) % 60).padStart(2, '0');
    const time = `${hour}:${minute}`;
    const isDeposit = i % 2 === 1;
    const amount = (5 + ((i * 3) % 45)) * 1000000;
    const withdrawal = isDeposit ? 0 : amount;
    const deposit = isDeposit ? amount : 0;
    runningBankBalance += deposit - withdrawal;
    totalBankDeposits += deposit;
    totalBankWithdrawals += withdrawal;

    let desc = isDeposit
      ? `واریز پایا بابت تسویه فاکتور فروش شماره ${i}`
      : `برداشت ساتنا بابت پرداخت به تأمین‌کننده ردیف ${i}`;
    if (i % 15 === 0) {
      desc = toArabicYeKaf(desc);
    }

    const ref = `TRK-1403-${String(500000 + i)}`;
    const branch = i % 2 === 0 ? 'شعبه مرکزی نمونه ۱۰۱' : 'شعبه شهرک صنعتی نمونه ۲۰۲';

    const wCell = withdrawal === 0 ? '0' : i % 20 === 0 ? toPersianDigits(withdrawal) : String(withdrawal);
    const dCell = deposit === 0 ? '0' : i % 21 === 0 ? toArabicDigits(deposit) : String(deposit);

    bankRows.push([
      date,
      time,
      desc,
      wCell,
      dCell,
      String(runningBankBalance),
      ref,
      branch,
    ]);
  }

  return {
    chartOfAccounts: { headers: chartOfAccountsHeaders, rows: chartOfAccountsRows },
    openingBalances: { headers: openingBalancesHeaders, rows: openingBalancesRows },
    counterparties: { headers: counterpartiesHeaders, rows: counterpartiesRows },
    items: { headers: itemsHeaders, rows: itemsRows },
    invoices: { headers: invoicesHeaders, rows: invoicesRows },
    bankStatement: { headers: bankHeaders, rows: bankRows },
    totals: {
      openingDebit: totalOpeningDebit,
      openingCredit: totalOpeningCredit,
      openingReceivables,
      openingPayables,
      closingReceivablesUnique: openingReceivables + uniqueSalesReceivablesDelta,
      closingReceivablesRaw: openingReceivables + salesReceivablesDelta,
      closingPayablesUnique: openingPayables + uniquePurchasePayablesDelta,
      closingPayablesRaw: openingPayables + purchasePayablesDelta,
      stockValue: totalStockValue,
      totalSalesGross,
      totalPurchasesGross,
      totalBankDeposits,
      totalBankWithdrawals,
      closingBankBalance: runningBankBalance,
    },
  };
}

function buildReadme(totals) {
  const fmt = (n) => Number(n).toLocaleString('en-US');
  return `# Sample Company Fixture — شرکت بازرگانی سپهر البرز نمونه (سهامی خاص)

Fictional Iranian trading company dataset for end-to-end data import tests.
All names, company titles, phone numbers (\`09000000xxx\`), national/economic IDs (\`10000000xxx\`), and emails (\`*@example.invalid\`) are synthetic test fixtures.

## Expected Totals (IRR / ریال)

| Metric | Amount (IRR) | Raw Integer (IRR) | Notes |
|---|---:|---:|---|
| **Debit (جمع بدهکار افتتاحیه)** | ${fmt(totals.openingDebit)} | \`${totals.openingDebit}\` | Balanced opening journal entry across 14 lines |
| **Credit (جمع بستانکار افتتاحیه)** | ${fmt(totals.openingCredit)} | \`${totals.openingCredit}\` | Exactly equals opening debit (\`debit === credit\`) |
| **Receivables — Opening (مانده اول دوره حساب‌های دریافتنی \`1201\`)** | ${fmt(totals.openingReceivables)} | \`${totals.openingReceivables}\` | Opening trade receivables balance |
| **Receivables — Closing Unique (مانده حساب‌های دریافتنی پس از صورتحساب‌های یکتا)** | ${fmt(totals.closingReceivablesUnique)} | \`${totals.closingReceivablesUnique}\` | Opening + unpaid unique sales invoices |
| **Receivables — Closing Raw (مانده حساب‌های دریافتنی با احتساب سطر تکراری)** | ${fmt(totals.closingReceivablesRaw)} | \`${totals.closingReceivablesRaw}\` | Opening + all unpaid sales invoice rows |
| **Payables — Opening (مانده اول دوره حساب‌های پرداختنی \`2101\`)** | ${fmt(totals.openingPayables)} | \`${totals.openingPayables}\` | Opening trade payables balance |
| **Payables — Closing Unique (مانده حساب‌های پرداختنی پس از صورتحساب‌های یکتا)** | ${fmt(totals.closingPayablesUnique)} | \`${totals.closingPayablesUnique}\` | Opening + unpaid unique purchase invoices |
| **Payables — Closing Raw (مانده حساب‌های پرداختنی با احتساب سطر تکراری)** | ${fmt(totals.closingPayablesRaw)} | \`${totals.closingPayablesRaw}\` | Opening + all unpaid purchase invoice rows |
| **Stock Value (ارزش موجودی کالا در انبار \`1301\`)** | ${fmt(totals.stockValue)} | \`${totals.stockValue}\` | Exact sum of \`quantity × unitCost\` across all 300 items |
| **Bank Closing Balance (مانده نهایی صورتحساب بانک \`1101\`)** | ${fmt(totals.closingBankBalance)} | \`${totals.closingBankBalance}\` | Opening bank balance + 100 statement lines |

## Generated Files

- \`chart-of-accounts.csv\` & \`chart-of-accounts.xlsx\` — 18 standard accounts
- \`opening-balances.csv\` & \`opening-balances.xlsx\` — 14 balanced opening lines (\`debit = credit = ${totals.openingDebit}\`)
- \`customers-suppliers.csv\`, \`customers-suppliers.xlsx\`, & \`customers-suppliers-win1256.csv\` — 50 rows (30 customers + 20 suppliers; includes Persian/Arabic digits, Arabic \`ي\`/\`ك\`, merged name & company, and 2 duplicate rows)
- \`items.csv\` & \`items.xlsx\` — 300 inventory items (\`stock value = ${totals.stockValue}\`)
- \`invoices.csv\` & \`invoices.xlsx\` — 240 sales & purchase invoices (144 sales + 96 purchases: 200 single-line + 40 multi-line with 2 to 6 items each, total 360 rows; includes 6 blank-customer walk-in rows, Persian/Arabic digits, Arabic \`ي\`/\`ك\`, and 2 duplicate rows)
- \`bank-statement.csv\` & \`bank-statement.xlsx\` — 100 bank statement lines
- \`sample-company.xlsx\` — Multi-sheet workbook containing all 6 tables

## Reproducibility

Regenerate from fixed seed (\`${SEED}\`):

\`\`\`bash
node e2e/fixtures/sample-company/generate.js
\`\`\`
`;
}

function main() {
  const data = generateDataset();

  const datasets = [
    ['chart-of-accounts', 'سرفصل_حسابها', data.chartOfAccounts],
    ['opening-balances', 'مانده_افتتاحیه', data.openingBalances],
    ['customers-suppliers', 'مشتریان_و_تامین_کنندگان', data.counterparties],
    ['items', 'کالاها', data.items],
    ['invoices', 'صورتحسابها', data.invoices],
    ['bank-statement', 'صورتحساب_بانک', data.bankStatement],
  ];

  for (const [slug, sheetName, table] of datasets) {
    const csvText = toCsvText(table.headers, table.rows);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.csv`), Buffer.from(csvText, 'utf8'));
    const xlsxBuf = buildXlsxWorkbook([
      { name: sheetName, headers: table.headers, rows: table.rows },
    ]);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.xlsx`), xlsxBuf);
  }

  // Combined multi-sheet XLSX
  const multiXlsx = buildXlsxWorkbook(
    datasets.map(([_slug, sheetName, table]) => ({
      name: sheetName,
      headers: table.headers,
      rows: table.rows,
    })),
  );
  fs.writeFileSync(path.join(OUT_DIR, 'sample-company.xlsx'), multiXlsx);

  // Windows-1256 CSV
  const cp1256CsvText = toCsvText(
    data.counterparties.headers,
    data.counterparties.rows,
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'customers-suppliers-win1256.csv'),
    encodeWindows1256(cp1256CsvText),
  );

  // README.md
  fs.writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    Buffer.from(buildReadme(data.totals), 'utf8'),
  );
}

main();
