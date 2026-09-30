# مانیفست پوشش حقوقی

این سند به‌صورت خودکار از فایل‌های `data/legal/*.jsonl` ساخته می‌شود (`scripts/legal_coverage_report.py`). شماره‌ها با `data/legal/coverage_manifest.json` یکسان است.

## خلاصه

| Metric | Value |
| --- | --- |
| Laws | 8 |
| Articles (rows) | 4216 |
| Active | 4198 |
| Inactive | 18 |
| Bills (لوایح) | 1 |
| Newest amendment date | 1395-11-10 |
| Newest approval date | 1402-06-22 |

## هشدارها

> ⚠️ نام «لایحه اصلاحی قانون تجارت» شامل «لایحه» است؛ لوایح قانون لازم‌الاجرا نیستند و نباید به‌عنوان قانون در حال اجرا استناد شوند.

## پوشش به تفکیک قانون

| Law | Type | Articles | Active | Inactive | Latest amendment | Approval date | Source |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| قانون مدنی | CIVIL | 1334 | 1323 | 11 | 1387-11-06 | - | dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22 |
| قانون مجازات اسلامی | CRIMINAL | 735 | 735 | 0 | 1395-08-16 | - | dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22 |
| قانون آیین دادرسی کیفری | PROCEDURE | 706 | 704 | 2 | 1395-11-10 | - | dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22 |
| قانون آیین دادرسی مدنی | PROCEDURE | 529 | 527 | 2 | - | 1379-01-21 | owner-supplied file |
| قانون تجارت | COMMERCIAL | 529 | 528 | 1 | 1358-10-26 | - | dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22 |
| لایحه اصلاحی قانون تجارت (لایحه) | COMMERCIAL | 301 | 301 | 0 | 1395-02-20 | - | dotic via HF endomorphosis/ipfs_iran_laws snapshot 2026-09-22 |
| قانون شوراهای حل اختلاف و دادگاه‌های صلح مصوب ۱۴۰۲ | PROCEDURE | 46 | 46 | 0 | - | 1402-06-22 | owner-supplied file |
| قانون صدور چک (اصلاحی ۱۳۹۷) | COMMERCIAL | 36 | 34 | 2 | - | 1355-04-16 | owner-supplied file |

> هیچ خروجی این سامانه مشاوره حقوقی نیست تا زمانی که وکیل رسمی ایرانی آن را بازبینی کند.
