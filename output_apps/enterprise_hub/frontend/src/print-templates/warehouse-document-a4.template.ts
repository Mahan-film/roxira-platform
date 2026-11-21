/** warehouse-document-a4.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const WAREHOUSE_DOCUMENT_A4_TEMPLATE = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>{{docTitle}} {{documentNumber}}</title>
<style>
/* Shared base for the print templates. Plain CSS, no build step.
   Templates link it as <link rel="stylesheet" href="print-base.css">.
   The host page provides the Vazirmatn @font-face (src/app/fonts/Vazirmatn-Variable.woff2). */
:root { --ink:#111; --muted:#555; --line:#222; --soft:#f2f2f2; }
* { box-sizing: border-box; }
html, body { margin:0; padding:0; background:#fff; color:var(--ink); }
body { font-family: Vazirmatn, Tahoma, "Segoe UI", sans-serif; font-size:11pt; line-height:1.55; direction:rtl; }
.sheet { padding:10mm; }
h1 { font-size:16pt; margin:0; text-align:center; }
h2 { font-size:11pt; margin:0 0 2mm; }
.muted { color:var(--muted); }
.num { direction:ltr; unicode-bidi:isolate; text-align:left; font-variant-numeric:tabular-nums; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; direction:ltr; unicode-bidi:isolate; }
.row { display:flex; gap:4mm; }
.row > * { flex:1; }
.box { border:1px solid var(--line); padding:2.5mm 3mm; }
.box > h2 { background:var(--soft); margin:-2.5mm -3mm 2mm; padding:1.2mm 3mm; border-bottom:1px solid var(--line); }
.kv { display:grid; grid-template-columns:auto 1fr; gap:0 3mm; }
.kv dt { color:var(--muted); } .kv dd { margin:0; }
table { width:100%; border-collapse:collapse; margin:3mm 0; }
th, td { border:1px solid var(--line); padding:1.2mm 1.8mm; vertical-align:top; }
th { background:var(--soft); font-weight:700; text-align:center; }
td.c { text-align:center; } td.n { text-align:left; direction:ltr; }
tfoot td { font-weight:700; }
thead { display:table-header-group; } tr { page-break-inside:avoid; }
.sign { display:flex; gap:4mm; margin-top:8mm; }
.sign > div { flex:1; border:1px solid var(--line); height:22mm; padding:1.5mm 2mm; font-size:9.5pt; color:var(--muted); }
.watermark { position:fixed; inset:0; display:none; align-items:center; justify-content:center; font-size:90pt; color:rgba(0,0,0,.07); transform:rotate(-25deg); pointer-events:none; }
.is-draft .watermark { display:flex; }
.hide-cost .cost { display:none; }
.footer-note { margin-top:4mm; font-size:9pt; color:var(--muted); text-align:center; }
@media print { .no-print { display:none !important; } a { color:inherit; text-decoration:none; } }
</style>
<style>@page { size: A4 portrait; margin: 8mm; }</style>
</head>
<body class="{{#if isDraft}}is-draft{{/if}} {{#if hideCost}}hide-cost{{/if}}">
<!-- docTitle: رسید انبار | حواله انبار | حواله انتقال بین انبارها | سند تعدیل انبار.
     counterpartyLabel: تأمین‌کننده | مشتری | انبار مقصد | واحد درخواست‌کننده.
     lines[]{row,itemCode,itemName,unit,quantity,unitCost,amount,description}.
     hideCost=true prints the clerk copy without the cost columns. -->
<div class="watermark">پیش‌نویس</div>
<div class="sheet">
  <div class="row" style="align-items:center">
    <div>{{#if logoUrl}}<img src="{{logoUrl}}" alt="" style="max-height:12mm;max-width:35mm;object-fit:contain;margin-bottom:1mm"><br>{{/if}}<b>{{company.name}}</b></div>
    <div><h1>{{docTitle}}</h1></div>
    <div><dl class="kv"><dt>شماره</dt><dd class="num">{{documentNumber}}</dd><dt>تاریخ</dt><dd class="num">{{dateJalali}}</dd></dl></div>
  </div>
  <div class="row" style="margin-top:3mm">
    <section class="box"><dl class="kv">
      <dt>انبار</dt><dd>{{warehouse.name}}</dd>
      {{#if destinationWarehouse}}<dt>انبار مقصد</dt><dd>{{destinationWarehouse.name}}</dd>{{/if}}
      <dt>{{counterpartyLabel}}</dt><dd>{{counterparty.name}}</dd></dl></section>
    <section class="box"><dl class="kv">
      <dt>مرجع</dt><dd class="num">{{referenceNumber}}</dd>
      <dt>سند حسابداری</dt><dd class="num">{{voucherNumber}}</dd>
      <dt>حمل‌کننده / پلاک</dt><dd>{{carrier}}</dd></dl></section>
  </div>
  <table>
    <thead><tr><th>ردیف</th><th>کد کالا</th><th>نام کالا</th><th>واحد</th><th>مقدار</th>
      <th class="cost">بهای واحد</th><th class="cost">مبلغ</th><th>توضیحات</th></tr></thead>
    <tbody>{{#each lines}}
      <tr><td class="c">{{row}}</td><td class="n">{{itemCode}}</td><td>{{itemName}}</td><td class="c">{{unit}}</td><td class="n">{{quantity}}</td>
        <td class="n cost">{{unitCost}}</td><td class="n cost">{{amount}}</td><td>{{description}}</td></tr>
    {{/each}}</tbody>
    <tfoot><tr><td colspan="4">جمع</td><td class="n">{{totals.quantity}}</td><td class="cost"></td><td class="n cost">{{totals.amount}}</td><td></td></tr></tfoot>
  </table>
  {{#if notes}}<p><b>توضیحات:</b> {{notes}}</p>{{/if}}
  <div class="sign">
    <div>انباردار</div>
    <div>{{receiverLabel}}</div>
    <div>تأییدکننده</div>
  </div>
  {{#if footerText}}<div class="footer-note">{{footerText}}</div>{{/if}}
</div>
</body>
</html>
`;
