/** sales-invoice-a5.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const SALES_INVOICE_A5_TEMPLATE = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>{{docTitle}} {{invoiceNumber}}</title>
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
  @page { size: A5 landscape; margin: 6mm; }
  body { font-size:9.5pt; line-height:1.4; }
  .sheet { padding:2mm; }
  h1 { font-size:13pt; }
  th, td { padding:.8mm 1.2mm; }
  .sign > div { height:14mm; }
</style>
</head>
<body class="{{#if isDraft}}is-draft{{/if}}">
<!-- Short invoice (up to ~8 lines). Same placeholders as sales-invoice-a4.html; fewer columns. -->
<div class="watermark">پیش‌نویس</div>
<div class="sheet">
  <div class="row" style="align-items:center">
    <div><b>{{seller.name}}</b><br><span class="muted">شماره اقتصادی: <span class="num">{{seller.economicCode}}</span> — شناسه ملی: <span class="num">{{seller.nationalId}}</span></span><br><span class="muted">{{seller.address}} — <span class="num">{{seller.phone}}</span></span></div>
    <div><h1>{{docTitle}}</h1></div>
    <div><dl class="kv"><dt>شماره</dt><dd class="num">{{invoiceNumber}}</dd><dt>تاریخ</dt><dd class="num">{{issueDateJalali}}</dd></dl></div>
  </div>
  {{#if isEinvoice}}<div class="box" style="margin-top:2mm">شماره منحصر به فرد مالیاتی: <span class="mono">{{taxId}}</span>
    {{#if trackingCode}} — کد رهگیری: <span class="mono">{{trackingCode}}</span>{{/if}}</div>{{/if}}
  <div class="box" style="margin-top:2mm"><b>خریدار:</b> {{buyer.name}}
    — شماره اقتصادی / ملی: <span class="num">{{buyer.economicCode}} {{buyer.nationalId}}</span>
    — کد پستی: <span class="num">{{buyer.postalCode}}</span> — {{buyer.address}}</div>
  <table>
    <thead><tr><th>ردیف</th><th>شناسه</th><th>شرح</th><th>تعداد</th><th>واحد</th><th>مبلغ واحد</th><th>تخفیف</th><th>مالیات</th><th>جمع کل</th></tr></thead>
    <tbody>{{#each lines}}
      <tr><td class="c">{{row}}</td><td class="n">{{itemId}}</td><td>{{description}}</td><td class="n">{{quantity}}</td><td class="c">{{unit}}</td>
        <td class="n">{{unitPrice}}</td><td class="n">{{discount}}</td><td class="n">{{vatAmount}}</td><td class="n">{{lineTotal}}</td></tr>
    {{/each}}</tbody>
    <tfoot><tr><td colspan="6">جمع</td><td class="n">{{totals.discount}}</td><td class="n">{{totals.vat}}</td><td class="n">{{totals.grand}}</td></tr></tfoot>
  </table>
  <div>به حروف: {{totals.grandInWords}} {{currencyLabel}} — تسویه: {{settlementMethod}}</div>
  <div class="sign"><div>مهر و امضای فروشنده</div><div>مهر و امضای خریدار</div></div>
</div>
</body>
</html>
`;
