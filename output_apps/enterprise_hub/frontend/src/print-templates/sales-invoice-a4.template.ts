/** sales-invoice-a4.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const SALES_INVOICE_A4_TEMPLATE = String.raw`<!doctype html>
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
  @page { size: A4 portrait; margin: 8mm; }
  .qr-slot { width:26mm; height:26mm; border:1px dashed var(--muted); display:flex; align-items:center; justify-content:center; font-size:8pt; color:var(--muted); }
  .taxid { font-size:12pt; letter-spacing:.5px; }
</style>
</head>
<body class="{{#if isDraft}}is-draft{{/if}}">
<div class="watermark">پیش‌نویس</div>
<div class="sheet">
  <div class="row" style="align-items:center">
    <div>{{#if logoUrl}}<img src="{{logoUrl}}" alt="" style="max-height:18mm">{{/if}}</div>
    <div><h1>{{docTitle}}</h1>
      {{#if isEinvoice}}<div class="muted" style="text-align:center">صورتحساب الکترونیکی نوع {{einvoiceType}} — الگوی {{pattern}}</div>{{/if}}</div>
    <div>
      <dl class="kv">
        <dt>شماره صورتحساب</dt><dd class="num">{{invoiceNumber}}</dd>
        <dt>تاریخ صدور</dt><dd class="num">{{issueDateJalali}} {{issueTime}}</dd>
        {{#if relatedTaxId}}<dt>صورتحساب مرجع</dt><dd class="mono">{{relatedTaxId}}</dd>{{/if}}
      </dl>
    </div>
  </div>

  {{#if isEinvoice}}
  <div class="box" style="margin-top:3mm">
    <div class="row" style="align-items:center">
      <div>
        <div class="muted">شماره منحصر به فرد مالیاتی</div>
        <div class="mono taxid">{{taxId}}</div>
        {{#if trackingCode}}<div class="muted" style="margin-top:1mm">کد رهگیری: <span class="mono">{{trackingCode}}</span></div>{{/if}}
        <div class="muted">{{sendStatusText}}</div>
      </div>
      {{#if showQr}}<!-- QR requirement is unverified (docs/accounting/research/PRINT_FORMS.md §1b) -->
      <div style="flex:0 0 28mm"><div class="qr-slot">{{qrSvg}}</div></div>{{/if}}
    </div>
  </div>
  {{/if}}

  <div class="row" style="margin-top:3mm">
    <section class="box"><h2>مشخصات فروشنده</h2>
      <dl class="kv">
        <dt>نام / نام شرکت</dt><dd>{{seller.name}}</dd>
        <dt>شماره اقتصادی</dt><dd class="num">{{seller.economicCode}}</dd>
        <dt>شناسه ملی</dt><dd class="num">{{seller.nationalId}}</dd>
        <dt>شماره ثبت</dt><dd class="num">{{seller.registrationNumber}}</dd>
        <dt>کد پستی</dt><dd class="num">{{seller.postalCode}}</dd>
        <dt>نشانی</dt><dd>{{seller.address}}</dd>
        <dt>تلفن</dt><dd class="num">{{seller.phone}}</dd>
        {{#if seller.branchCode}}<dt>کد شعبه</dt><dd class="num">{{seller.branchCode}}</dd>{{/if}}
      </dl></section>
    <section class="box"><h2>مشخصات خریدار</h2>
      <dl class="kv">
        <dt>نام / نام شرکت</dt><dd>{{buyer.name}}</dd>
        <dt>شماره اقتصادی</dt><dd class="num">{{buyer.economicCode}}</dd>
        <dt>شماره / شناسه ملی</dt><dd class="num">{{buyer.nationalId}}</dd>
        <dt>شماره ثبت</dt><dd class="num">{{buyer.registrationNumber}}</dd>
        <dt>کد پستی</dt><dd class="num">{{buyer.postalCode}}</dd>
        <dt>نشانی</dt><dd>{{buyer.address}}</dd>
        <dt>تلفن</dt><dd class="num">{{buyer.phone}}</dd>
      </dl></section>
  </div>

  {{#if extraHeaderFacts}}
  <div class="box" style="margin-top:3mm"><h2>اطلاعات تکمیلی الگو</h2>
    <dl class="kv">{{#each extraHeaderFacts}}<dt>{{label}}</dt><dd class="num">{{value}}</dd>{{/each}}</dl></div>
  {{/if}}

  <table>
    <thead><tr>
      <th>ردیف</th><th>شناسه کالا/خدمت</th><th>شرح کالا یا خدمت</th><th>تعداد</th><th>واحد</th>
      <th>مبلغ واحد</th><th>مبلغ قبل از تخفیف</th><th>تخفیف</th><th>مبلغ بعد از تخفیف</th>
      <th>نرخ مالیات</th><th>مالیات بر ارزش افزوده</th><th>جمع کل</th>
    </tr></thead>
    <tbody>
    {{#each lines}}
      <tr><td class="c">{{row}}</td><td class="n">{{itemId}}</td><td>{{description}}</td>
        <td class="n">{{quantity}}</td><td class="c">{{unit}}</td><td class="n">{{unitPrice}}</td>
        <td class="n">{{amountBeforeDiscount}}</td><td class="n">{{discount}}</td><td class="n">{{amountAfterDiscount}}</td>
        <td class="c">{{vatRate}}</td><td class="n">{{vatAmount}}</td><td class="n">{{lineTotal}}</td></tr>
    {{/each}}
    </tbody>
    <tfoot>
      <tr><td colspan="6">جمع</td><td class="n">{{totals.beforeDiscount}}</td><td class="n">{{totals.discount}}</td>
        <td class="n">{{totals.afterDiscount}}</td><td></td><td class="n">{{totals.vat}}</td><td class="n">{{totals.grand}}</td></tr>
    </tfoot>
  </table>

  {{#if isForeign}}
  <div class="row" style="margin-top:2mm">
    <div>مبلغ به ارز: <span class="num">{{foreignTotalText}}</span></div>
    <div>معادل ریالی: <span class="num">{{rialEquivalentText}}</span></div>
  </div>
  {{/if}}

  <div class="row">
    <section class="box"><h2>شرایط پرداخت</h2>
      <dl class="kv">
        <dt>روش تسویه</dt><dd>{{settlementMethod}}</dd>
        <dt>نقدی</dt><dd class="num">{{cashAmount}}</dd>
        <dt>نسیه</dt><dd class="num">{{creditAmount}}</dd>
        <dt>سایر مالیات و عوارض</dt><dd class="num">{{totals.otherTaxes}}</dd>
      </dl></section>
    <section class="box"><h2>مبلغ قابل پرداخت</h2>
      <div class="num" style="font-size:14pt;font-weight:700">{{totals.grand}} {{currencyLabel}}</div>
      <div>به حروف: {{totals.grandInWords}}</div></section>
  </div>
  {{#if notes}}<p><b>توضیحات:</b> {{notes}}</p>{{/if}}

  <div class="sign">
    <div>مهر و امضای فروشنده</div>
    <div>مهر و امضای خریدار</div>
  </div>
  <div class="footer-note">{{footerText}}</div>
</div>
</body>
</html>
`;
