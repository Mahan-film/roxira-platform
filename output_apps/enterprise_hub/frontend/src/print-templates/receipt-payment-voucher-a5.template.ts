/** receipt-payment-voucher-a5.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const RECEIPT_PAYMENT_VOUCHER_A5_TEMPLATE = String.raw`<!doctype html>
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
<style>@page { size: A5 landscape; margin: 6mm; } body{font-size:10pt;line-height:1.45} .sign>div{height:16mm}</style>
</head>
<body class="{{#if isDraft}}is-draft{{/if}}">
<!-- docTitle: رسید دریافت | رسید پرداخت. partyLabel: دریافت از | پرداخت به.
     payments[]{method,detail,amount}: method = نقد (صندوق) | واریز بانکی | چک | کارتخوان -->
<div class="watermark">پیش‌نویس</div>
<div class="sheet">
  <div class="row" style="align-items:center">
    <div><b>{{company.name}}</b></div>
    <div><h1>{{docTitle}}</h1></div>
    <div><dl class="kv"><dt>شماره</dt><dd class="num">{{documentNumber}}</dd><dt>تاریخ</dt><dd class="num">{{dateJalali}}</dd></dl></div>
  </div>
  <div class="box" style="margin-top:3mm">
    <dl class="kv">
      <dt>{{partyLabel}}</dt><dd>{{party.name}} <span class="muted num">{{party.code}}</span></dd>
      <dt>مبلغ</dt><dd><b class="num">{{amount}}</b> {{currencyLabel}} — به حروف: {{amountInWords}}</dd>
      <dt>بابت</dt><dd>{{purpose}}</dd>
      {{#if invoiceRefs}}<dt>فاکتورهای مرتبط</dt><dd class="num">{{invoiceRefs}}</dd>{{/if}}
      {{#if voucherNumber}}<dt>سند حسابداری</dt><dd class="num">{{voucherNumber}}</dd>{{/if}}
    </dl>
  </div>
  <table>
    <thead><tr><th>روش</th><th>جزئیات (حساب، شماره پیگیری، شماره چک، بانک، سررسید)</th><th>مبلغ</th></tr></thead>
    <tbody>{{#each payments}}<tr><td class="c">{{method}}</td><td>{{detail}}</td><td class="n">{{amount}}</td></tr>{{/each}}</tbody>
    <tfoot><tr><td colspan="2">جمع</td><td class="n">{{paymentsTotal}}</td></tr></tfoot>
  </table>
  <div class="sign"><div>{{signerLeftLabel}}</div><div>{{signerRightLabel}}</div><div>تأییدکننده</div></div>
</div>
</body>
</html>
`;
