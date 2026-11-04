#!/usr/bin/env node
/**
 * Streams a synthetic import fixture to disk without holding it in memory.
 *
 *   node gen-fixture.js csv  <out> <rows>            wide CSV, ~420 bytes a row
 *   node gen-fixture.js sql  <out> <rows>            MySQL-style dump with multi-row INSERTs
 *   node gen-fixture.js xlsx <out> <sheets> <rowsPerSheet>
 *   node gen-fixture.js zip  <outDir> <files> <rowsPerFile>   a folder of CSVs (zip it with `zip -r`)
 *
 * Data is deterministic and Persian-flavoured (UTF-8 names, Jalali dates, rial amounts).
 */
const fs = require('fs');
const path = require('path');

const FIRST = ['علی', 'محمد', 'حسین', 'رضا', 'مریم', 'زهرا', 'فاطمه', 'سارا', 'امیر', 'نگار', 'کاوه', 'پریسا'];
const LAST = ['احمدی', 'محمدی', 'رضایی', 'کریمی', 'حسینی', 'موسوی', 'صادقی', 'اکبری', 'یوسفی', 'قاسمی'];
const CITY = ['تهران', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'کرج', 'اهواز', 'قم'];
const STREET = 'خیابان ولیعصر، کوچه شهید بهشتی، پلاک';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function record(i, rand) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
  const city = CITY[(i * 3) % CITY.length];
  const amount = Math.floor(rand() * 9_000_000_000) + 1000;
  const date = `14${String(0 + (i % 5)).padStart(2, '0')}/${String((i % 12) + 1).padStart(2, '0')}/${String((i % 28) + 1).padStart(2, '0')}`;
  return {
    id: String(i + 1),
    code: `C-${String(i + 1).padStart(9, '0')}`,
    name,
    national_id: String(1000000000 + ((i * 7919) % 8999999999)).slice(0, 10),
    date,
    amount: String(amount),
    balance: String(Math.floor(rand() * 1_000_000_000) - 500_000_000),
    city,
    address: `${city}، ${STREET} ${(i % 300) + 1}، طبقه ${(i % 9) + 1}، واحد ${(i % 40) + 1}`,
    phone: `0912${String(1000000 + ((i * 31) % 8999999))}`,
    email: `user${i + 1}@example.test`,
    note: `سند شمارهٔ ${i + 1} - بابت فروش کالا و خدمات؛ توضیحات تکمیلی برای ردیف ${i + 1} ثبت شد.`,
  };
}

const COLUMNS = ['id', 'code', 'name', 'national_id', 'date', 'amount', 'balance', 'city', 'address', 'phone', 'email', 'note'];

function csvField(v) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function writeLines(file, header, rows, line, footer) {
  const out = fs.createWriteStream(file, { highWaterMark: 4 * 1024 * 1024 });
  const rand = rng(12345);
  const write = (s) => (out.write(s) ? null : new Promise((r) => out.once('drain', r)));
  if (header) await write(header);
  let buf = '';
  for (let i = 0; i < rows; i += 1) {
    buf += line(record(i, rand), i);
    if (buf.length > 1 << 20) {
      const p = write(buf);
      buf = '';
      if (p) await p;
    }
  }
  if (buf) await write(buf);
  if (footer) await write(footer);
  await new Promise((r) => out.end(r));
}

async function main() {
  const [kind, out, a, b] = process.argv.slice(2);
  if (kind === 'csv') {
    await writeLines(out, COLUMNS.join(',') + '\n', Number(a), (r) => COLUMNS.map((c) => csvField(r[c])).join(',') + '\n');
  } else if (kind === 'sql') {
    const rows = Number(a);
    const header = `-- MySQL dump 10.13  Distrib 8.0\nSET NAMES utf8mb4;\nDROP TABLE IF EXISTS \`customers\`;\nCREATE TABLE \`customers\` (\n${COLUMNS.map((c) => `  \`${c}\` varchar(255) DEFAULT NULL`).join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;\nLOCK TABLES \`customers\` WRITE;\n`;
    const PER = 500;
    let pending = [];
    const tuples = [];
    await writeLines(
      out,
      header,
      rows,
      (r, i) => {
        pending.push('(' + COLUMNS.map((c) => `'${r[c].replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(',') + ')');
        if (pending.length === PER || i === rows - 1) {
          const stmt = `INSERT INTO \`customers\` VALUES ${pending.join(',')};\n`;
          pending = [];
          return stmt;
        }
        return '';
      },
      'UNLOCK TABLES;\n',
    );
    void tuples;
  } else if (kind === 'zipdir') {
    fs.mkdirSync(out, { recursive: true });
    const files = Number(a);
    const per = Number(b);
    for (let f = 0; f < files; f += 1) {
      await writeLines(path.join(out, `part-${String(f + 1).padStart(3, '0')}.csv`), COLUMNS.join(',') + '\n', per, (r) => COLUMNS.map((c) => csvField(r[c])).join(',') + '\n');
    }
  } else if (kind === 'xlsx') {
    const { Zip, ZipDeflate, ZipPassThrough, strToU8 } = require('fflate');
    const sheets = Number(a);
    const rowsPerSheet = Number(b);
    const outStream = fs.createWriteStream(out, { highWaterMark: 4 * 1024 * 1024 });
    const zip = new Zip((err, chunk, final) => {
      if (err) throw err;
      outStream.write(Buffer.from(chunk));
      if (final) outStream.end();
    });
    const add = (name, level) => {
      const f = level === 0 ? new ZipPassThrough(name) : new ZipDeflate(name, { level });
      zip.add(f);
      return f;
    };
    const small = (name, text) => {
      const f = add(name, 6);
      f.push(strToU8(text), true);
    };
    small('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
    small('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${Array.from({ length: sheets }, (_, k) => `<sheet name="Sheet${k + 1}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`);
    small('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships>${Array.from({ length: sheets }, (_, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}</Relationships>`);
    small('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>');
    // Shared strings: 100k distinct names + cities (realistic repetition).
    const names = [];
    for (let k = 0; k < 100000; k += 1) names.push(`${FIRST[k % FIRST.length]} ${LAST[(k * 7) % LAST.length]} ${k}`);
    small('xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${names.map((n) => `<si><t>${n}</t></si>`).join('')}</sst>`);
    const sheetHeader = COLUMNS;
    const colName = (k) => String.fromCharCode(65 + k);
    for (let s = 0; s < sheets; s += 1) {
      const f = add(`xl/worksheets/sheet${s + 1}.xml`, 1);
      let buf = '<?xml version="1.0"?><worksheet><sheetData>';
      const rand = rng(777 + s);
      const flush = async (force) => {
        if (buf.length > (1 << 20) || force) {
          f.push(strToU8(buf), false);
          buf = '';
          await new Promise((r) => setImmediate(r));
        }
      };
      buf += `<row r="1">${sheetHeader.map((h, k) => `<c r="${colName(k)}1" t="inlineStr"><is><t>${h}</t></is></c>`).join('')}</row>`;
      for (let i = 0; i < rowsPerSheet; i += 1) {
        const r = record(i, rand);
        const n = i + 2;
        buf += `<row r="${n}"><c r="A${n}"><v>${r.id}</v></c><c r="B${n}" t="inlineStr"><is><t>${r.code}</t></is></c><c r="C${n}" t="s"><v>${i % 100000}</v></c><c r="D${n}" t="inlineStr"><is><t>${r.national_id}</t></is></c><c r="E${n}" t="inlineStr"><is><t>${r.date}</t></is></c><c r="F${n}"><v>${r.amount}</v></c><c r="G${n}"><v>${r.balance}</v></c><c r="H${n}" t="inlineStr"><is><t>${r.city}</t></is></c><c r="I${n}" t="inlineStr"><is><t>${r.address}</t></is></c><c r="J${n}" t="inlineStr"><is><t>${r.phone}</t></is></c><c r="K${n}" t="inlineStr"><is><t>${r.email}</t></is></c><c r="L${n}" t="inlineStr"><is><t>${r.note}</t></is></c></row>`;
        await flush(false);
      }
      buf += '</sheetData></worksheet>';
      await flush(true);
      f.push(new Uint8Array(0), true);
    }
    zip.end();
    await new Promise((r) => outStream.on('close', r));
  } else {
    console.error('usage: gen-fixture.js csv|sql <out> <rows> | xlsx <out> <sheets> <rowsPerSheet> | zipdir <dir> <files> <rowsPerFile>');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
