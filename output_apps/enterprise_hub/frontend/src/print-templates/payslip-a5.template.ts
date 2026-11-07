/** payslip-a5.html with print-base.css inlined: a print window has no stylesheet to link to. */
export const PAYSLIP_A5_TEMPLATE = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>فیش حقوقی {{employee.fullName}} {{monthName}} {{year}}</title>
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
  @page { size: A5 portrait; margin: 6mm; }
  body { font-size:9.5pt; line-height:1.4; }
  table { margin:2mm 0; }
  .col2 { display:flex; gap:3mm; } .col2 > div { flex:1; }
</style>
</head>
<body>
<!-- Mirrors PayslipPrint in modules/hr/services/payslip-pdf.ts. All amounts pre-formatted rials.
     totalDeductions = sum of the deduction rows (derived by the caller, not a PayslipPrint field). Zero-valued earning/deduction rows may be hidden by the caller. -->
<div class="sheet">
  <h1>فیش حقوقی — {{monthName}} {{year}}</h1>
  <div class="muted" style="text-align:center">{{company.name}}</div>
  <div class="box" style="margin-top:2mm"><dl class="kv">
    <dt>نام و نام خانوادگی</dt><dd>{{employee.fullName}}</dd>
    <dt>شماره پرسنلی</dt><dd class="num">{{employee.number}}</dd>
    <dt>کد ملی</dt><dd class="num">{{employee.nationalId}}</dd>
    <dt>شماره بیمه</dt><dd class="num">{{employee.insuranceNumber}}</dd>
    <dt>سمت</dt><dd>{{employee.jobTitle}}</dd>
    <dt>روزهای کارکرد</dt><dd class="num">{{workDays}}</dd>
    <dt>شماره فیش</dt><dd class="num">{{payslipNumber}}</dd>
  </dl></div>
  <div class="col2">
    <div><table>
      <thead><tr><th colspan="2">مزایا</th></tr></thead>
      <tbody>
        <tr><td>حقوق مبنا</td><td class="n">{{baseSalary}}</td></tr>
        <tr><td>پایه سنوات</td><td class="n">{{seniorityAmount}}</td></tr>
        <tr><td>حق مسکن</td><td class="n">{{housingAllowance}}</td></tr>
        <tr><td>کمک‌هزینه اقلام مصرفی</td><td class="n">{{foodAllowance}}</td></tr>
        <tr><td>حق اولاد</td><td class="n">{{childAllowance}}</td></tr>
        <tr><td>حق تأهل</td><td class="n">{{marriageAllowance}}</td></tr>
        <tr><td>سایر مزایا</td><td class="n">{{allowancesTotal}}</td></tr>
        <tr><td>اضافه‌کار</td><td class="n">{{overtimeAmount}}</td></tr>
        <tr><td>شب‌کاری</td><td class="n">{{nightShiftAmount}}</td></tr>
        <tr><td>کار در تعطیلات</td><td class="n">{{holidayAmount}}</td></tr>
        <tr><td>عیدی / پاداش</td><td class="n">{{eidiAmount}}</td></tr>
      </tbody>
      <tfoot><tr><td>جمع مزایا (ناخالص)</td><td class="n">{{grossPay}}</td></tr></tfoot>
    </table></div>
    <div><table>
      <thead><tr><th colspan="2">کسورات</th></tr></thead>
      <tbody>
        <tr><td>کسر غیبت</td><td class="n">{{absenceDeduction}}</td></tr>
        <tr><td>حق بیمه سهم کارگر</td><td class="n">{{insuranceDeduction}}</td></tr>
        <tr><td>مالیات حقوق</td><td class="n">{{incomeTax}}</td></tr>
        <tr><td>سایر کسورات</td><td class="n">{{otherDeductions}}</td></tr>
      </tbody>
      <tfoot><tr><td>جمع کسورات</td><td class="n">{{totalDeductions}}</td></tr></tfoot>
    </table>
    <table><tbody>
      <tr><td><b>خالص پرداختی</b></td><td class="n"><b>{{netPay}}</b></td></tr>
      <tr><td class="muted">سهم کارفرما (بیمه)</td><td class="n muted">{{employerInsurance}}</td></tr>
      <tr><td class="muted">بیمه بیکاری</td><td class="n muted">{{unemploymentInsurance}}</td></tr>
    </tbody></table></div>
  </div>
  <div class="sign" style="margin-top:3mm"><div style="height:14mm">امضای کارمند</div><div style="height:14mm">مهر و امضای کارفرما</div></div>
</div>
</body>
</html>
`;
