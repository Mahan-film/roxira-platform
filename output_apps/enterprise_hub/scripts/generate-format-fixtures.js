/**
 * Generates the format fixtures used by modules/data_import/readers/*.spec.ts.
 *
 * Binary formats (XLS/ODS/XLSX/DBF) are written by SheetJS — an independent writer — so the readers
 * are not only tested against their own mirror image. Run once and commit the output:
 *
 *   mkdir /tmp/fixgen && cd /tmp/fixgen && npm i xlsx@0.18.5
 *   NODE_PATH=/tmp/fixgen/node_modules node scripts/generate-format-fixtures.js
 *
 * Everything here is synthetic. Files marked "stub" only carry the real magic bytes of the format
 * (Access, SQL Server backup, pg_dump custom) so detection + the Persian guide can be tested.
 */
/* eslint-disable */
process.env.TZ = 'UTC'; // SheetJS writes date cells in local time; keep fixtures reproducible
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cptable = require('codepage');
const { zipSync, strToU8 } = require('fflate');

const out = path.join(__dirname, '..', 'modules', 'data_import', '__fixtures__');
const fmt = path.join(out, 'formats');
const bad = path.join(out, 'hostile');
fs.mkdirSync(fmt, { recursive: true });
fs.mkdirSync(bad, { recursive: true });
const w = (dir, name, data) => fs.writeFileSync(path.join(dir, name), data);

const HEAD = ['شماره سند', 'تاریخ', 'کد حساب', 'بدهکار', 'بستانکار', 'شرح'];
const ROWS = [
  ['JV-1', '1403/07/15', '1101', 5000000, 0, 'دریافت نقدی'],
  ['JV-1', '1403/07/15', '4101', 0, 5000000, 'فروش نقدی'],
  ['JV-2', '1403/07/16', '5101', 1200000, 0, 'هزینه حمل'],
  ['JV-2', '1403/07/16', '1101', 0, 1200000, 'پرداخت نقدی'],
];
const ACCOUNTS_HEAD = ['کد حساب', 'نام حساب', 'نوع'];
const ACCOUNTS = [['1101', 'صندوق', 'asset'], ['4101', 'فروش', 'revenue'], ['5101', 'هزینه حمل', 'expense']];

const csv = (rows, sep = ',') => rows.map((r) => r.join(sep)).join('\r\n') + '\r\n';
const all = [HEAD, ...ROWS];

// ---- text formats ----
w(fmt, 'journal.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv(all), 'utf8')]));
w(fmt, 'journal.tsv', csv(all, '\t'));
w(fmt, 'journal-semicolon.csv', csv(all, ';'));
// Windows-1256, Arabic yeh/kaf (ي ك) as many old Iranian systems write them, Persian digits in dates
// cp1256 has no Persian digits: real files carry ASCII digits here
const arabicRows = [HEAD, ['JV-1', '1403/07/15', '1101', '5000000', '0', 'دريافت نقدي كالا']];
w(fmt, 'journal-cp1256.csv', Buffer.from(cptable.utils.encode(1256, csv(arabicRows))));
w(fmt, 'journal-utf16le.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv(all), 'utf16le')]));
const widths = [10, 12, 10, 12, 12, 20];
w(fmt, 'journal-fixed.txt', all.map((r) => r.map((c, i) => String(c).padEnd(widths[i])).join('  ')).join('\n') + '\n');
w(fmt, 'journal.json', JSON.stringify({ accounts: ACCOUNTS.map(([code, name, type]) => ({ code, name, type })), journal: ROWS.map((r) => ({ voucherNo: r[0], date: r[1], accountCode: r[2], debit: r[3], credit: r[4], description: r[5] })) }, null, 1));
w(fmt, 'journal.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<ledger>\n${ROWS.map((r) => `  <line voucher="${r[0]}"><date>${r[1]}</date><account>${r[2]}</account><debit>${r[3]}</debit><credit>${r[4]}</credit><memo>${r[5]}</memo></line>`).join('\n')}\n</ledger>\n`);
w(fmt, 'journal-table.xls', `<html><head><meta charset="utf-8"></head><body><table>\n<tr>${HEAD.map((h) => `<th>${h}</th>`).join('')}</tr>\n${ROWS.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}\n</table></body></html>`);

// ---- spreadsheets / dbf (SheetJS writes them) ----
const ws = XLSX.utils.aoa_to_sheet(all);
const wsAcc = XLSX.utils.aoa_to_sheet([ACCOUNTS_HEAD, ...ACCOUNTS]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'journal');
XLSX.utils.book_append_sheet(wb, wsAcc, 'accounts');
w(fmt, 'journal.xls', XLSX.write(wb, { bookType: 'biff8', type: 'buffer' }));
w(fmt, 'journal.ods', XLSX.write(wb, { bookType: 'ods', type: 'buffer' }));
w(fmt, 'journal.xlsx', XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
// title rows above the table, a date cell, and a number with decimals (xls)
const wsDate = XLSX.utils.aoa_to_sheet([
  ['گزارش گردش حساب'], [], ['تاریخ', 'مبلغ'], [new Date(Date.UTC(2024, 9, 6)), 1234.5], [new Date(Date.UTC(2024, 9, 7)), 99],
], { cellDates: true });
const wbDate = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wbDate, wsDate, 'گردش');
w(fmt, 'dates-title.xls', XLSX.write(wbDate, { bookType: 'biff8', type: 'buffer', cellDates: true }));
const dbfRows = [['VOUCHER', 'DATE', 'ACCOUNT', 'DEBIT', 'CREDIT'], ...ROWS.map((r) => [r[0], r[1].replace(/\//g, ''), r[2], r[3], r[4]])];
const dbfBuf = () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(dbfRows), 'S');
  return Buffer.from(XLSX.write(book, { bookType: 'dbf', type: 'buffer' }));
};
w(fmt, 'journal.dbf', dbfBuf());

// ---- SQL dumps (text, never executed) ----
w(fmt, 'mysql-dump.sql.txt', `-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
DROP TABLE IF EXISTS \`accounts\`;
CREATE TABLE \`accounts\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`code\` varchar(20) NOT NULL,
  \`name\` varchar(255) DEFAULT NULL,
  \`type\` varchar(20) DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_code\` (\`code\`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
LOCK TABLES \`accounts\` WRITE;
INSERT INTO \`accounts\` VALUES (1,'1101','صندوق','asset'),(2,'4101','فروش \\'نقدی\\'','revenue'),(3,'5101','O''Brien; test\\nline2',NULL);
UNLOCK TABLES;
CREATE TABLE \`journal_lines\` (
  \`id\` int NOT NULL,
  \`voucher_no\` varchar(20),
  \`account_code\` varchar(20),
  \`debit\` decimal(18,2),
  \`credit\` decimal(18,2),
  CONSTRAINT \`fk_acc\` FOREIGN KEY (\`account_code\`) REFERENCES \`accounts\` (\`code\`)
) ENGINE=InnoDB;
INSERT INTO \`journal_lines\` VALUES (1,'JV-1','1101',5000000.00,0.00),(2,'JV-1','4101',0.00,5000000.00);
`);
w(fmt, 'postgres-dump.sql.txt', `--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET client_encoding = 'UTF8';
CREATE TABLE public.accounts (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name text,
    type text
);
CREATE FUNCTION public.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.x := 1; RETURN NEW; END; $$;
COPY public.accounts (id, code, name, type) FROM stdin;
1\t1101\tصندوق\tasset
2\t4101\tفروش\\tنقدی\trevenue
3\t5101\t\\N\texpense
\\.
CREATE TABLE public.journal_lines (voucher_no text, account_code text, debit numeric, credit numeric);
INSERT INTO public.journal_lines (voucher_no, account_code, debit, credit) VALUES ('JV-1', '1101', 5000000, 0), ('JV-1', '4101', 0, 5000000);
ALTER TABLE ONLY public.journal_lines ADD CONSTRAINT fk_acc FOREIGN KEY (account_code) REFERENCES public.accounts(code);
`);
w(fmt, 'mssql-script.sql.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`SET ANSI_NULLS ON
GO
CREATE TABLE [dbo].[accounts]([code] [nvarchar](20) NOT NULL, [name] [nvarchar](255) NULL)
GO
INSERT [dbo].[accounts] ([code], [name]) VALUES (N'1101', N'صندوق')
INSERT [dbo].[accounts] ([code], [name]) VALUES (N'4101', N'فروش; نقدی')
GO
`, 'utf16le')]));
w(fmt, 'sqlite-dump.sql.txt', `PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE accounts (code TEXT, name TEXT, type TEXT);
INSERT INTO accounts VALUES('1101','صندوق','asset');
INSERT INTO accounts VALUES('4101','فروش','revenue');
COMMIT;
`);

// ---- accounting formats ----
w(fmt, 'quickbooks.iif', [
  '!HDR\tPROD\tVER\tREL\tIIFVER\tDATE\tTIME\tACCNTNT\tACCNTNTSPLITTIME',
  'HDR\tQuickBooks Pro\tVersion 2003\tRelease R1\t1\t10/6/2024\t1728200000\tN\t0',
  '!ACCNT\tNAME\tACCNTTYPE\tDESC',
  'ACCNT\tCash\tBANK\tCash on hand',
  'ACCNT\tSales\tINC\tSales income',
  '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
  '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
  '!ENDTRNS',
  'TRNS\t\tGENERAL JOURNAL\t10/6/2024\tCash\t\t500.00\tJV-1\tCash sale',
  'SPL\t\tGENERAL JOURNAL\t10/6/2024\tSales\t\t-500.00\tJV-1\tCash sale',
  'ENDTRNS',
  '',
].join('\r\n'));
w(fmt, 'bank.ofx', `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20241006<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>123456789<ACCTID>987654321<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20241001<DTEND>20241031
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20241003120000<TRNAMT>-45.50<FITID>A1<NAME>Coffee shop<MEMO>Card 1234</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20241004<TRNAMT>1500.00<FITID>A2<NAME>Client payment</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1454.50<DTASOF>20241031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`);

// ---- guide-only stubs (real magic bytes; .sql/.bak extensions are avoided because they are git-ignored, no real payload) ----
const pad = (head, n = 8192) => Buffer.concat([head, Buffer.alloc(n - head.length)]);
w(fmt, 'stub-access.mdb', pad(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.from('Standard Jet DB\0', 'latin1')])));
w(fmt, 'stub-sqlserver.bak.bin', pad(Buffer.from('TAPE', 'latin1')));
w(fmt, 'stub-pgdump-custom.dump', pad(Buffer.from('PGDMP\x01\x0e\x00', 'latin1')));
// 8-bit text that is not Windows-1256 Persian (digits 0x80-0x89 + letter forms) -> must be refused, not mangled
w(fmt, 'iran-system-like.csv', Buffer.concat(Array.from({ length: 40 }, (_, i) => Buffer.from([0x91, 0x92, 0x93, 0x2c, 0x80 + (i % 10), 0x80 + ((i + 1) % 10), 0x2c, 0x94, 0x95, 0x96, 0x97, 0x0a]))));

// ---- hostile samples ----
const zipOf = (files) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));
w(bad, 'zip-slip.zip', zipOf({ '../../evil.csv': 'a,b\n1,2\n', 'ok/data.csv': 'a,b\n1,2\n', '/abs/etc.csv': 'a,b\n3,4\n' }));
w(bad, 'zip-nested.zip', zipOf({ 'inner.zip': zipOf({ 'x.csv': 'a,b\n1,2\n' }) }));
w(bad, 'xml-xxe.xml', '<?xml version="1.0"?>\n<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n<r><i><a>&x;</a></i><i><a>2</a></i></r>\n');
w(bad, 'xml-billion-laughs.xml', '<?xml version="1.0"?>\n<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>\n<lolz>&lol2;</lolz>\n');
w(bad, 'xml-deep.xml', '<a>'.repeat(5000) + 'x' + '</a>'.repeat(5000));
w(bad, 'json-deep.json', '['.repeat(5000) + ']'.repeat(5000));
const lying = dbfBuf();
lying.writeUInt32LE(4000000000, 4);
w(bad, 'dbf-lying-count.dbf', lying);
const xlsBuf = Buffer.from(XLSX.write(wb, { bookType: 'biff8', type: 'buffer' }));
w(bad, 'xls-truncated.xls', xlsBuf.subarray(0, Math.floor(xlsBuf.length / 2)));
w(bad, 'sql-attach-stacked.sql.txt', "PRAGMA foreign_keys=OFF;\nCREATE TABLE t(a);\nINSERT INTO t VALUES(1);\nATTACH DATABASE '/etc/passwd' AS x;\nDROP TABLE t;\n");
w(bad, 'mysql-hostile.sql.txt', `/*!40101 SET NAMES utf8mb4 */;
DROP DATABASE prod;
CREATE TABLE \`t\` (\`a\` int, \`b\` text) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1,'ok'),(2,LOAD_FILE('/etc/passwd')),(3,(SELECT password FROM mysql.user LIMIT 1));
INSERT INTO \`t\` SELECT * FROM secrets;
SELECT SLEEP(100000);
GRANT ALL ON *.* TO 'x'@'%';
`);
w(bad, 'csv-formula.csv', 'name,amount\n"=HYPERLINK(""http://evil"",""x"")",1\n+cmd|\' /C calc\'!A0,2\n@SUM(1+1),3\n');
const odsBomb = zipSync({
  mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
  'content.xml': strToU8('<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet><table:table table:name="S"><table:table-row><table:table-cell office:value-type="string"><text:p>a</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>b</text:p></table:table-cell></table:table-row><table:table-row table:number-rows-repeated="1000000000"><table:table-cell table:number-columns-repeated="1000000000" office:value-type="string"><text:p>x</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>'),
});
w(bad, 'ods-repeat-bomb.ods', Buffer.from(odsBomb));
console.log('fixtures written to', out);
