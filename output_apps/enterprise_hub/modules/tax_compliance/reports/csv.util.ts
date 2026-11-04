/** UTF-8 BOM so Excel opens Persian text correctly. */
const BOM = '﻿';

/**
 * Text cells starting with `= + - @ TAB CR` are prefixed with `'` so a buyer
 * name typed by a customer cannot execute as a spreadsheet formula.
 */
function cell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  // A plain signed decimal (a negative balance) is data, not a formula.
  const plainNumber = /^-?\d+(\.\d+)?$/.test(value);
  const safe = !plainNumber && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return BOM + [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
