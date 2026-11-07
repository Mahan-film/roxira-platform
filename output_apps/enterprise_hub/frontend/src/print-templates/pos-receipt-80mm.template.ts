/** pos-receipt-80mm.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const POS_RECEIPT_80MM_TEMPLATE = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>رسید فروش {{receiptNumber}}</title>
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
<style>
  @page { size: 80mm auto; margin: 3mm; }
  html, body { width:72mm; }
  body { font-size:10pt; line-height:1.35; }
  .sheet { padding:0; }
  h1 { font-size:12pt; }
  hr { border:0; border-top:1px dashed #000; margin:2mm 0; }
  .ln { display:flex; justify-content:space-between; gap:2mm; }
  .item { margin:1mm 0; }
  .item .sub { color:var(--muted); font-size:9pt; }
  .tot { font-weight:700; font-size:11pt; }
  .c { text-align:center; }
</style>
</head>
<body>
<!-- Anonymous type-2 sale: buyer block omitted. Amounts pre-formatted rials. -->
<div class="sheet">
  <h1>{{shop.name}}</h1>
  <div class="c muted">{{shop.address}}<br><span class="num">{{shop.phone}}</span></div>
  <div class="c muted">شماره اقتصادی: <span class="num">{{shop.economicCode}}</span></div>
  <hr>
  <div class="ln"><span>رسید</span><span class="num">{{receiptNumber}}</span></div>
  <div class="ln"><span>تاریخ</span><span class="num">{{dateJalali}} {{time}}</span></div>
  <div class="ln"><span>صندوقدار</span><span>{{cashier}}</span></div>
  <hr>
  {{#each lines}}
  <div class="item"><div>{{name}}</div>
    <div class="ln sub"><span class="num">{{quantity}} × {{unitPrice}}</span><span class="num">{{lineTotal}}</span></div></div>
  {{/each}}
  <hr>
  <div class="ln"><span>جمع</span><span class="num">{{subtotal}}</span></div>
  {{#if discount}}<div class="ln"><span>تخفیف</span><span class="num">{{discount}}</span></div>{{/if}}
  <div class="ln"><span>مالیات بر ارزش افزوده</span><span class="num">{{vat}}</span></div>
  <div class="ln tot"><span>مبلغ قابل پرداخت</span><span class="num">{{total}}</span></div>
  <hr>
  {{#each payments}}<div class="ln"><span>{{method}}</span><span class="num">{{amount}}</span></div>{{/each}}
  {{#if change}}<div class="ln"><span>باقی‌مانده</span><span class="num">{{change}}</span></div>{{/if}}
  {{#if taxId}}<hr><div class="c muted">شماره منحصر به فرد مالیاتی</div><div class="c mono" style="font-size:9pt">{{taxId}}</div>
    {{#if trackingCode}}<div class="c muted">کد رهگیری: <span class="mono">{{trackingCode}}</span></div>{{/if}}{{/if}}
  <hr>
  <div class="c muted">{{footerText}}</div>
</div>
</body>
</html>
`;
