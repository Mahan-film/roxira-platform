# Brief #483: Design v2 number, money and date foundation

Worktree: /home/mahan/Developer/roxira-wt/483-design-v2-number-money-and-date-foundati
App: output_apps/enterprise_hub/frontend (Next 15 + React, Tailwind v4, RTL Persian). Paths below are relative to it.
Do NOT commit, push, or run npm install. Do NOT edit package.json, any lockfile, src/components/app-shell.tsx, or anything under modules/. Do not add dependencies.
Tests run with `npx --yes tsx --test <file>` (node:test + node:assert/strict). Test files import siblings WITH the `.ts` extension, like src/lib/fa-format.test.ts. Pure lib files must not import React, Next or the `@/` alias (relative `./x.ts` imports only) so tsx can run them.
Existing helpers to reuse (read them first): src/lib/jalali.ts (jalaliToIso, isoToJalaliInput, internal jalCal), src/lib/fa-format.ts (formatAmount with `brackets` option, formatReportMoney, PERSIAN digit helpers), src/lib/money-unit.ts (useMoneyUnit), src/components/ui/jalali-date-input.tsx (existing component, keep its props `value` ISO, `onChange(iso)`, `id`, `disabled`), src/components/ui/input.tsx.
Money rule: rials are integers. NEVER use float or Number for amounts in the new logic: strings and BigInt only.

## 1. src/lib/jalali.ts (edit): add exports
- `isJalaliLeapYear(jy: number): boolean` (use jalCal(jy).leap === 0) and `jalaliMonthLength(jy: number, jm: number): number` (31 for 1-6, 30 for 7-11, month 12: 30 if leap else 29). Make jalaliToIso use jalaliMonthLength. Behaviour of existing functions must not change.
- `jalaliToIso` stays. Add `isoToJalaliParts(iso: string): {jy:number; jm:number; jd:number} | null` built on the existing Intl formatter logic.

## 2. src/lib/persian-words.ts (new) + persian-words.test.ts
`integerToPersianWords(value: bigint | string): string` for non-negative integers; string input must be digits only (ASCII or Persian digits), else throw RangeError. Words joined by " و ".
Tables: units 0..19 صفر یک دو سه چهار پنج شش هفت هشت نه ده یازده دوازده سیزده چهارده پانزده شانزده هفده هجده نوزده; tens بیست سی چهل پنجاه شصت هفتاد هشتاد نود; hundreds صد دویست سیصد چهارصد پانصد ششصد هفتصد هشتصد نهصد.
Groups of three digits with scale words: هزار (10^3), میلیون (10^6), میلیارد (10^9). Above that recurse on the part above 10^9: n = q*10^9 + r, words(q) + " میلیارد" + (r>0 ? " و " + words(r) : ""). So 10^12 = "هزار میلیارد" and 10^15 = "یک میلیون میلیارد".
Multiplier 1 is omitted only for هزار ("هزار", not "یک هزار"); it is kept for میلیون and میلیارد ("یک میلیون").
Expected values (computed by hand, test them exactly):
- 0 -> "صفر"
- 7 -> "هفت"; 15 -> "پانزده"; 21 -> "بیست و یک"; 100 -> "صد"; 101 -> "صد و یک"; 999 -> "نهصد و نود و نه"
- 1000 -> "هزار"; 1001 -> "هزار و یک"; 2000 -> "دو هزار"; 12500 -> "دوازده هزار و پانصد"
- 1000000 -> "یک میلیون"; 1001000 -> "یک میلیون و هزار"
- 12500000 -> "دوازده میلیون و پانصد هزار"
- 1234567 -> "یک میلیون و دویست و سی و چهار هزار و پانصد و شصت و هفت"
- 1000000000 -> "یک میلیارد"
- 25000000000 -> "بیست و پنج میلیارد"
- 1000000000000 -> "هزار میلیارد"
- 1500000000000 -> "هزار و پانصد میلیارد"
- "9007199254740993" (2^53+1, beyond Number precision) -> "نه میلیون و هفت هزار و صد و نود و نه میلیارد و دویست و پنجاه و چهار میلیون و هفتصد و چهل هزار و نهصد و نود و سه" (q = 9,007,199 and r = 254,740,993 around 10^9).
- "۱۲۵۰۰" (Persian digits) -> "دوازده هزار و پانصد"; "abc" and "-5" throw RangeError.

## 3. src/lib/money-input.ts (new) + money-input.test.ts
All functions pure; amounts are strings of ASCII digits ("rial digits").
- `MAX_MONEY_DIGITS = 18`.
- `normalizeMoneyDigits(raw: string): string`: convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII, drop everything that is not a digit (spaces, ٬ , ، . / letters, minus), strip leading zeros but keep a single "0" when the input had only zeros, truncate to 18 digits. "" -> "". Examples: "۱۲٬۵۰۰٬۰۰۰" -> "12500000"; "0012" -> "12"; "000" -> "0"; "12.5" -> "125" (decimals are not supported: rials are whole); "-5" -> "5".
- `appendZeros(digits: string, count: 3 | 4): string`: empty or "0" stays as is (nothing to multiply); otherwise append that many zeros, then truncate to 18 digits by REFUSING (return the input unchanged if the result would exceed 18 digits). "5" + 3 -> "5000"; "5" + 4 -> "50000"; "" + 3 -> ""; "0" + 3 -> "0"; 17 digits + 3 -> unchanged.
- `formatGroupedRials(digits: string): string`: Persian digits with ٬ every three digits, "" -> "". "12500000" -> "۱۲٬۵۰۰٬۰۰۰"; "0" -> "۰".
- `rialsToToman(digits: string): string`: exact BigInt, 1 toman = 10 rial. Whole toman: grouped Persian ("12500000" -> "۱٬۲۵۰٬۰۰۰"); remainder 5 rials shows ٫۵ ("12345" -> "۱٬۲۳۴٫۵"); other remainders are written as the exact decimal digit ("12347" -> "۱٬۲۳۴٫۷"); "0" -> "۰"; "7" -> "۰٫۷". "" -> "".
- `describeRials(digits: string): { toman: string; words: string } | null`: null for "". Otherwise toman = rialsToToman(digits) + " تومان" and words = integerToPersianWords(digits) + " ریال". Examples: "12500000" -> toman "۱٬۲۵۰٬۰۰۰ تومان", words "دوازده میلیون و پانصد هزار ریال"; "0" -> "۰ تومان", "صفر ریال"; "1000000000000" -> "۱۰۰٬۰۰۰٬۰۰۰٬۰۰۰ تومان", "هزار میلیارد ریال".
- `applyMoneyEdit(rawText: string, caret: number): { digits: string; text: string; caret: number }`: for the controlled input: digits = normalizeMoneyDigits(rawText), text = formatGroupedRials(digits), caret = position in `text` placed after the same number of digit characters that were to the left of `caret` in rawText (count digits only; if that number is clamped by truncation use text.length). Tests: applyMoneyEdit("1250", 4) -> digits "1250", text "۱٬۲۵۰", caret 5; applyMoneyEdit("12345", 2) -> digits "12345", text "۱۲٬۳۴۵", caret 2 (two digits left of the caret, the second digit ends at index 2); applyMoneyEdit("", 0) -> digits "", text "", caret 0.

## 4. src/lib/balance.ts (new) + balance.test.ts
`balanceMarker(net: string | number | bigint | null | undefined): { side: "debit" | "credit" | "zero"; label: "بد" | "بس" | "بی‌حساب"; abs: string } | null`. `net` = debit minus credit in rials, exact decimal strings allowed (like "-12500000.5"; "+" not needed). Positive -> debit «بد», negative -> credit «بس», zero (including "0", "-0", "0.00") -> «بی‌حساب»; abs is the unsigned decimal string with a trailing ".00"/zeros preserved as given minus the sign (just drop the leading "-"). null for null/undefined/""/non-numeric. Numbers go through String(n) only when Number.isFinite, else null. Test: "12500000" -> debit; "-12500000" -> credit, abs "12500000"; "0.00" -> zero; 0 -> zero; "abc" -> null; "-0.00" -> zero.
Note the spelling of «بی‌حساب» uses ZWNJ (U+200C) between ی and ح.

## 5. src/lib/jalali-date-input.ts (new) + jalali-date-input.test.ts
Pure logic for the date field. Digits are ASCII internally, output text uses Persian digits and "/" separators.
- `maskJalaliInput(raw: string): string`: take ASCII/Persian/Arabic digits only, max 8; layout yyyy[/mm[/dd]], with the slash appearing only once the next digit exists. Persian output. "14050814" -> "۱۴۰۵/۰۸/۱۴"; "1405" -> "۱۴۰۵"; "14050" -> "۱۴۰۵/۰"; "۱۴۰۵/۰۸/۱۴" (already masked) -> same; "1405/8/14" has 7 digits 1405814 -> "۱۴۰۵/۸۱/۴" (straight digit layout; the validator flags it). "" -> "". 123456789 -> truncated to "۱۲۳۴/۵۶/۷۸".
- `checkJalaliText(text: string): { state: "empty" | "partial" | "valid" | "invalid"; iso?: string; message?: string }`: empty for ""; for a 8-digit complete text: valid with iso (via jalaliToIso) or invalid with message "تاریخ شمسی معتبر نیست" (impossible day/month/leap). For partial text: invalid as soon as the month part has 2 digits and is 00 or >12, or the day part has 2 digits and is 00 or >31, or year has 4 digits outside 1200..1600; otherwise partial.
- `stepJalaliText(text: string, unit: "day" | "month" | "year", delta: number): string | null`: from a valid complete text returns the masked Persian text moved by delta; day steps cross month and year boundaries correctly using the real calendar (via jalaliToIso and ISO date arithmetic in UTC); month/year steps keep the day but clamp it to the target month length (1403/12/30 +1 year -> "۱۴۰۴/۱۲/۲۹"). Returns null when the text is not valid (the component then starts from today).
- `todayJalaliIso(now: Date = new Date()): string`: the Gregorian ISO date of the current Jalali calendar day in Asia/Tehran. Use Intl.DateTimeFormat with timeZone "Asia/Tehran" and the "en-CA" locale for the Gregorian y-m-d of Tehran time (no UTC shortcut: 2026-11-04T21:00:00Z is already 2026-11-05 in Tehran, +3:30).
- `jalaliPresets(todayIso: string): Array<{ key: string; label: string; from: string; to: string }>` (from and to are Gregorian ISO dates, inclusive). Based on the Jalali year/month of todayIso (jy). Keys and labels in this order: `today` «امروز» (from=to=todayIso); `month` «این ماه» (first and last day of the current Jalali month, last day from jalaliMonthLength); `spring` «بهار ۱۴۰۵» = 01/01..03/31; `summer` «تابستان ۱۴۰۵» = 04/01..06/31; `autumn` «پاییز ۱۴۰۵» = 07/01..09/30; `winter` «زمستان ۱۴۰۵» = 10/01..12/(29 or 30); `fiscal` «سال مالی ۱۴۰۵» = 01/01..12/(29 or 30). Labels use the Persian digits of the real year.
Expected values (verified with Intl, put them in the tests exactly):
- todayIso "2026-11-05" is 1405/08/14. month: 2026-10-23 .. 2026-11-21 (Aban 1405 = 1405/08/01 is 2026-10-23, 30 days, ends 1405/08/30 = 2026-11-21). spring 2026-03-21 .. 2026-06-21; summer 2026-06-22 .. 2026-09-22; autumn 2026-09-23 .. 2026-12-21; winter 2026-12-22 .. 2027-03-20; fiscal 2026-03-21 .. 2027-03-20. (1405 is not a leap year: Esfand has 29 days.)
- For todayIso "2025-03-10" (1403/12/20): winter and fiscal end on 1403/12/30 = 2025-03-20; winter starts 1403/10/01 = 2024-12-21; fiscal starts 1403/01/01 = 2024-03-20; this month 2025-02-19 .. 2025-03-20.
- Leap years: tests with known Jalali leap years 1399, 1403, 1408, 1412 (leap) and 1400, 1401, 1402, 1404, 1405, 1406, 1407, 1409 (not leap) through isJalaliLeapYear. jalaliToIso("1403/12/30") = "2025-03-20" and jalaliToIso("1404/12/30") = null and jalaliToIso("1408/12/30") = "2030-03-20", jalaliToIso("1405/12/30") = null, jalaliToIso("1405/12/29") = "2027-03-20", jalaliToIso("1405/07/31") = null (Mehr has 30), jalaliToIso("1405/06/31") = "2026-09-22", jalaliToIso("1405/13/01") = null, jalaliToIso("1405/00/10") = null.
- mask/check: checkJalaliText("۱۴۰۵/۰۸/۱۴") -> valid, iso "2026-11-05"; checkJalaliText("۱۴۰۴/۱۲/۳۰") -> invalid; checkJalaliText("۱۴۰۳/۱۲/۳۰") -> valid iso "2025-03-20"; checkJalaliText("۱۴۰۵/۱۳") -> invalid; checkJalaliText("۱۴۰۵/۰۸/۳۲") -> invalid; checkJalaliText("۱۴۰۵/۰۸") -> partial; checkJalaliText("") -> empty.
- step: stepJalaliText("۱۴۰۵/۰۸/۱۴","day",1) = "۱۴۰۵/۰۸/۱۵"; ("۱۴۰۵/۰۸/۳۰","day",1) = "۱۴۰۵/۰۹/۰۱"; ("۱۴۰۵/۱۲/۲۹","day",1) = "۱۴۰۶/۰۱/۰۱"; ("۱۴۰۳/۱۲/۲۹","day",1) = "۱۴۰۳/۱۲/۳۰"; ("۱۴۰۳/۱۲/۳۰","day",1) = "۱۴۰۴/۰۱/۰۱"; ("۱۴۰۵/۰۱/۰۱","day",-1) = "۱۴۰۴/۱۲/۲۹"; ("۱۴۰۵/۰۷/۳۰","month",1) = "۱۴۰۵/۰۸/۳۰"; ("۱۴۰۵/۰۶/۳۱","month",1) = "۱۴۰۵/۰۷/۳۰"; ("۱۴۰۳/۱۲/۳۰","year",1) = "۱۴۰۴/۱۲/۲۹"; ("۱۴۰۵/۰۸","day",1) = null.
- todayJalaliIso(new Date("2026-11-04T21:00:00Z")) = "2026-11-05"; todayJalaliIso(new Date("2026-11-04T10:00:00Z")) = "2026-11-04".

## 6. src/lib/balance.ts and money display components
- `src/components/ui/money.tsx` (new, "use client"): exports
  - `Money({ value, unit?, suffix?, className })`: renders a `<span className="num ...">` using formatAmount(value, unit ?? useMoneyUnit()[0], { suffix: suffix ?? false, brackets: true }). When the value is negative: add class `money-negative` AND the text carries the parentheses from formatAmount, plus a visually hidden `<span className="sr-only">منفی </span>` before it. Never colour alone: the brackets are the primary cue. Missing value shows «—» without the negative class.
  - `Balance({ value, unit?, className })`: uses balanceMarker; renders the absolute amount (formatAmount of abs with suffix false) followed by the marker label in a small `<span>` («بد» / «بس» / «بی‌حساب»); zero shows only «بی‌حساب» (no amount) with muted foreground. Null -> «—». Credit side uses class `money-negative`? NO: balance side is NOT an error, so keep normal foreground; the label is the cue.
- `src/app/globals.css` (edit): inside `@layer base` add `body { font-variant-numeric: tabular-nums; }` (applies everywhere) and in `@layer utilities` add `.num { font-variant-numeric: tabular-nums; }` and `.money-negative { color: var(--money-negative); }`. Define `--money-negative` in :root and in .dark: a muted red with contrast >= 4.5:1 against that theme's --background AND --card/--muted surfaces: light about oklch(0.48 0.15 25) and dark about oklch(0.78 0.11 22). Also add a focus-visible rule only if one is missing for the new inputs: do not change existing focus styles. Look at the other theme blocks near line 581 (`--gh-*`): add `--money-negative` there too using the same approach (derive from `--gh-danger` if it meets contrast, else pick a darker/lighter variant). I will measure contrast in a browser afterwards.
- `src/components/ui/table.tsx` (edit): add `tabular-nums` to the base className of Table so every table inherits it (keep other classes).

## 7. src/components/ui/money-input.tsx (new, "use client")
`MoneyInput({ value, onChange, id, disabled, placeholder, className, helper = true, "aria-label"?, "aria-invalid"? })`. `value` is the rial digit string (ASCII digits, "" when empty); `onChange(digits: string)` always emits the ASCII digit string from normalizeMoneyDigits (so a parent doing Number(value) behaves exactly as before for integers).
- Renders the existing `Input` with dir="ltr", inputMode="numeric", autoComplete="off", className "text-start tabular-nums", showing formatGroupedRials(value). onChange uses applyMoneyEdit and restores the caret in a layout effect (useRef + setSelectionRange) so typing in the middle keeps the caret.
- Shortcut buttons under the input: two small `Button variant="outline" size="sm"` labeled «۰۰۰» and «۰۰۰۰» (aria-label «افزودن سه صفر» / «افزودن چهار صفر») calling appendZeros(value, 3|4). Keyboard: in the input, `Alt+3`? No: keep it simple: typing "k" or "K" appends 000 and typing "m"/"M"... no. Only: Ctrl+ArrowUp appends 000 and Ctrl+Shift+ArrowUp appends 0000. Buttons are type="button" and keep focus order after the input.
- Live helper `<div id={helperId} aria-live="polite">` under the input (only when helper=true and value !== ""): line 1 «معادل <toman>» (describeRials.toman), line 2 the words (describeRials.words). Classes `text-xs text-muted-foreground`. The input has aria-describedby={helperId}. Use React `useId`.
- When helper is false (tight table cells) render only the input plus a `title` attribute holding the toman + words, no buttons.

## 8. src/components/ui/jalali-date-input.tsx (rewrite, keep props, add optional `presets?: boolean` default false, `presetEdge?: "from" | "to"` default "from")
- State: `text` (masked Persian text) synced from `value` ISO when it changes from outside (do not clobber while the user types: only resync when value differs from the iso of the current text). Use `isoToJalaliInput` then maskJalaliInput to show Persian digits.
- onChange of the field: text = maskJalaliInput(event.target.value); status = checkJalaliText(text); when valid call onChange(iso); when empty call onChange(""); when partial/invalid do NOT call onChange (keeps last valid value as before) and show aria-invalid plus the role="alert" message for invalid.
- Keyboard: ArrowUp = +1 day, ArrowDown = -1 day, Shift = month, Ctrl/Meta = year (preventDefault). If the current text is not valid, start from today (todayJalaliIso). Emit onChange with the new iso.
- A row of buttons under the field only when `presets` is true: a native `<select aria-label="میان‌بر تاریخ">` listing jalaliPresets(todayJalaliIso()); choosing one sets the date to preset.from or preset.to per presetEdge. When `presets` is false still render no buttons. Also a compact «امروز» button is NOT needed.
- Keep dir="ltr", inputMode numeric, placeholder «۱۴۰۵/۰۸/۱۴», aria-invalid, text-start tabular-nums. Existing callers (cheques-list, report-controls, fiscal-years page, reports page, petty-cash page) must keep working unchanged.

## 9. Adoption on the journal entry form: src/components/accounting/journal-entry-form.tsx
- Date: `JalaliDateInput` gets `presets`. Keep `date`/`setDate` semantics (ISO).
- Debit and credit cells: replace the two `<Input inputMode="decimal">` with `<MoneyInput helper={false} ...>`; value is still `line.debit` / `line.credit` strings and onChange sets exactly like before (the other side cleared). The submit code `Number(line.debit)` is NOT touched, so the posted payload does not change.
- Totals «جمع بدهکار» / «جمع بستانکار» use `<Money value={totalDebit}/>` instead of formatRial. Leave the balance difference logic unchanged (the colour classes there may stay).
- Do not change other logic, labels or the payload. Keep the diff in this file small.

## 10. Not to touch / report
Do not edit package.json (the `test` script line needs the four new test files; I will report it). Do not add files outside the list above. Run `npx --yes tsx --test` on each new test file and fix failures in the implementation, never by changing an expected value above. If an expected value above looks wrong, say so in your final message. Finish with a summary listing files changed and the test counts.
