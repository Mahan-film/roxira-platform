# Social Security (Tamin) monthly list disk: DSKKAR00.DBF and DSKWOR00.DBF field spec

Status: **field names, types and widths verified from one published source; encoding and several rules `unclear`.**
Researched 2026-11-04 for requirement INS-01. Nothing below is invented: a cell that no source states says `unclear`.

## Sources

| # | Source | What it gives | Date / weight |
| --- | --- | --- | --- |
| S1 | https://virasarmaye.ir/نرم-افزار-ارسال-لیست-حق-بیمه-تامین-اجتماع/ (page text fetched and read directly on 2026-11-04) | Reproduces the "مشخصات جداول" pages 51 and 52 of the Tamin Machine Services "سیستم وصول حق بیمه" document: the full column table of both files (Ref, Atr, Type, Column Name, description). Also says the same data may be sent as comma-separated `DSKWOR.TXT` and `DSKKAR.TXT` "following attachments 1 and 2". | Undated, floppy-disk era (it talks of diskettes). Third-party copy of an SSO contractor document. Not the current v6 program help. |
| S2 | https://accsupport.nosa.com/tabid/63/aft/2591/Default.aspx | Confirms the two file names, that `DSKKAR00.DBF` is one summary record and `DSKWOR00.DBF` one row per employee, and that the structure is "the SSO guideline". No field table, no code page. | Vendor support forum. |
| S3 | https://www.bidbarg.com/bimeh/42005/... | Default output names `DSKKAR00.dbf` and `DSKWOR00.dbf`; no fields. | Blog. |
| S4 | tamin.ir list-disk program help (v6) | **Not found.** Not reachable from the build machine and not returned by search. | n/a |

The field names and order of S1 match the names the repo already used (from the owner's research report) exactly (all 23 and all 27 columns, in the same order), which is the strongest evidence that S1 describes the same file family. S1 does **not** say which program
version it belongs to; whether it is "list v6" is `unclear`.

## Rules that apply to the whole file (all `unclear` unless stated)

| Topic | Value | Status |
| --- | --- | --- |
| File type | dBase table (`.DBF`), one record per row | verified (S1, S2, S3) |
| Summary file | `DSKKAR00.DBF` has exactly one record | verified (S2) |
| Detail file | `DSKWOR00.DBF` has one record per insured person | verified (S2) |
| Alternative | `DSKKAR.TXT` / `DSKWOR.TXT`, values separated by `,` in the table order | stated by S1 only; not implemented |
| Numbers | Latin digits | verified (S1) |
| Character code page | Windows-1256 is what the writer uses; S1 only says the Persian language (Farsi) must be set on the PC | **unclear** |
| DBF version byte, language-driver byte | writer uses `0x03` and `0x7E` | **unclear** |
| Decimals of `N(n)` columns | none stated; writer uses 0 | **unclear** |
| Date columns `C(8)` | format not stated; writer uses compact Jalali `YYYYMMDD` | **unclear** |
| Truncation | text longer than the width is cut by the writer and reported as a warning; numbers wider than the column refuse the export | our rule |

## DSKKAR00.DBF (workshop, 1 record), 23 columns

| # | Field | Type | Length | Meaning (S1) | Rule in the writer | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | DSK_ID | C | 10 | شماره کارگاه | workshop code | verified |
| 2 | DSK_NAME | C | 30 | نام کارگاه | | verified |
| 3 | DSK_FARM | C | 30 | نام کارفرما | | verified |
| 4 | DSK_ADRS | C | 40 | نشانی کارگاه | | verified |
| 5 | DSK_KIND | N | 1 | نوع لیست | 0 | name/width verified; allowed values `unclear` |
| 6 | DSK_YY | N | 2 | سال | two-digit year | width verified; two-digit year `unclear` |
| 7 | DSK_MM | N | 2 | ماه | | verified |
| 8 | DSK_LISTNO | C | 12 | شماره لیست | | width verified; format `unclear` |
| 9 | DSK_DISC | C | 30 | شرح لیست | | verified |
| 10 | DSK_NUM | N | 5 | تعداد نفرات لیست | rows in DSKWOR | verified |
| 11 | DSK_TDD | N | 6 | جمع روزهای کارکرد لیست | sum DSW_DD | verified |
| 12 | DSK_TROOZ | N | 12 | جمع دستمزد روزانه | sum DSW_ROOZ | verified |
| 13 | DSK_TMAH | N | 12 | جمع دستمزد ماهانه | sum DSW_MAH | verified |
| 14 | DSK_TMAZ | N | 12 | جمع مزایای ماهانه مشمول کسر حق بیمه | sum DSW_MAZ | verified |
| 15 | DSK_TMASH | N | 12 | جمع کل دستمزد و مزایای ماهانه مشمول کسر حق بیمه | sum DSW_MASH | verified |
| 16 | DSK_TTOTL | N | 12 | جمع کل دستمزد و مزایای ماهانه مشمول و غیر مشمول | sum DSW_TOTL | verified |
| 17 | DSK_TBIME | N | 12 | جمع حق بیمه سهم بیمه شده | sum DSW_BIME | verified |
| 18 | DSK_TKOSO | N | 12 | جمع حق بیمه سهم کارفرما | employer share | verified |
| 19 | DSK_BIC | N | 12 | جمع بیمه بیکاری | unemployment | verified |
| 20 | DSK_RATE | N | 5 | نرخ حق بیمه (مجموع سهم بیمه شده و کارفرما) | 23 | width verified; whole percent vs two decimals `unclear` |
| 21 | DSK_PRATE | N | 2 | نرخ پورسانتاژ | 0 | name/width verified; use `unclear` |
| 22 | DSK_BIMH | N | 12 | حق بیمه مشاغل (۴٪) | 0 | name/width verified; use `unclear` |
| 23 | MON_PYM | C | 3 | ردیف پیمان | `000` | verified |

## DSKWOR00.DBF (one record per insured person), 27 columns

| # | Field | Type | Length | Meaning (S1) | Rule in the writer | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | DSW_ID | C | 10 | شماره کارگاه | workshop code | verified |
| 2 | DSW_YY | N | 2 | سال | | as DSK_YY |
| 3 | DSW_MM | N | 2 | ماه | | verified |
| 4 | DSW_LISTNO | C | 12 | شماره لیست | | as DSK_LISTNO |
| 5 | DSW_ID1 | C | 8 | شماره بیمه شده | insurance number | **unclear**: S1 says width 8; the owner's report says 10 digits with leading zeros. The writer keeps 10 so a 10-digit number is never cut |
| 6 | DSW_FNAME | C | 50 | نام بیمه شده | | verified |
| 7 | DSW_LNAME | C | 50 | نام خانوادگی | | verified |
| 8 | DSW_DNAME | C | 50 | نام پدر | | verified |
| 9 | DSW_IDNO | C | 15 | شماره شناسنامه | national id (we do not store the ID-card number) | verified width |
| 10 | DSW_IDPLC | C | 30 | محل صدور شناسنامه | empty (not collected) | verified width |
| 11 | DSW_IDATE | C | 8 | تاریخ صدور شناسنامه | empty (not collected) | width verified; format `unclear` |
| 12 | DSW_BDATE | C | 8 | تاریخ تولد | `YYYYMMDD` Jalali | width verified; format `unclear` |
| 13 | DSW_SEX | C | 3 | جنسیت | `مرد` / `زن` | width verified; words vs codes `unclear` |
| 14 | DSW_NAT | C | 10 | ملیت | `ایرانی` | width verified; words vs codes `unclear` |
| 15 | DSW_OCP | C | 50 | شرح شغل | job title | verified |
| 16 | DSW_SDATE | C | 8 | تاریخ شروع بکار | | format `unclear` |
| 17 | DSW_EDATE | C | 8 | تاریخ ترک کار | | format `unclear` |
| 18 | DSW_DD | N | 2 | تعداد روزهای کارکرد | | verified |
| 19 | DSW_ROOZ | N | 12 | دستمزد روزانه | | verified |
| 20 | DSW_MAH | N | 12 | دستمزد ماهانه | daily wage x days | verified |
| 21 | DSW_MAZ | N | 12 | مزایای ماهانه مشمول کسر حق بیمه | | verified |
| 22 | DSW_MASH | N | 12 | جمع دستمزد و مزایای ماهانه مشمول کسر حق بیمه (مأخذ محاسبه) | | verified |
| 23 | DSW_TOTL | N | 12 | جمع دستمزد و مزایای ماهانه مشمول و غیر مشمول | | verified |
| 24 | DSW_BIME | N | 12 | حق بیمه سهم بیمه شده | | verified |
| 25 | DSW_PRATE | N | 2 | نرخ پورسانتاژ | 0 | name/width verified; use `unclear` |
| 26 | DSW_JOB | C | 6 | کد شغل | empty (no SSO job code stored) | width verified |
| 27 | PER_NATCOD | C | 10 | کد ملی بیمه شده | national id | verified |

## What `uploadReady` means

The export reports `uploadReady: true` only when **every** row above and every whole-file rule is `verified`. Today it
is `false`, and the response lists each unclear item in `unverified`, which the payroll page shows. To close it, one real
file written by the current SSO List Disk program (or its v6 help text) is needed: its code page, language-driver byte
and the width of `DSW_ID1` settle most of the list.
