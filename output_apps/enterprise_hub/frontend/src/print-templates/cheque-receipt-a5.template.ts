/** cheque-receipt-a5.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const CHEQUE_RECEIPT_A5_TEMPLATE = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>رسید چک {{receiptNumber}}</title>
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
<style>@page { size: A5 landscape; margin: 6mm; } body{font-size:9.5pt;line-height:1.4} .sign>div{height:16mm}</style>
</head>
<body class="{{#if isDraft}}is-draft{{/if}}">
<!-- directionLabel: رسید دریافت چک | رسید پرداخت چک.
     receiptNumber, dateJalali, partyLabel, party{name,nationalId}, purpose, invoiceRefs, chequeCount, total, totalInWords, currencyLabel,
     cheques[]{row,number,sayadId,bank,branch,owner,accountNumber,dueDateJalali,amount,status} -->
<div class="watermark">پیش‌نویس</div>
<div class="sheet">
  <div class="row" style="align-items:center">
    <div><b>{{company.name}}</b></div>
    <div><h1>{{directionLabel}}</h1></div>
    <div><dl class="kv"><dt>شماره رسید</dt><dd class="num">{{receiptNumber}}</dd><dt>تاریخ</dt><dd class="num">{{dateJalali}}</dd></dl></div>
  </div>
  <p>{{partyLabel}}: <b>{{party.name}}</b> <span class="muted">({{party.nationalId}})</span> — بابت: {{purpose}} {{#if invoiceRefs}}(فاکتور <span class="num">{{invoiceRefs}}</span>){{/if}}</p>
  <table>
    <thead><tr><th>ردیف</th><th>شماره چک</th><th>شناسه صیاد</th><th>بانک / شعبه</th><th>صاحب حساب</th><th>شماره حساب</th><th>سررسید</th><th>مبلغ</th><th>وضعیت</th></tr></thead>
    <tbody>{{#each cheques}}
      <tr><td class="c">{{row}}</td><td class="n">{{number}}</td><td class="n">{{sayadId}}</td><td>{{bank}} {{branch}}</td><td>{{owner}}</td>
        <td class="n">{{accountNumber}}</td><td class="n">{{dueDateJalali}}</td><td class="n">{{amount}}</td><td class="c">{{status}}</td></tr>
    {{/each}}</tbody>
    <tfoot><tr><td colspan="7">جمع ({{chequeCount}} فقره)</td><td class="n">{{total}}</td><td></td></tr></tfoot>
  </table>
  <div>به حروف: {{totalInWords}} {{currencyLabel}}</div>
  <div class="sign"><div>تحویل‌دهنده</div><div>تحویل‌گیرنده</div><div>مهر شرکت</div></div>
</div>
</body>
</html>
`;
