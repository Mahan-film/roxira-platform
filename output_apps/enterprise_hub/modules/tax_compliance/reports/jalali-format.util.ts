/** `1405/03/31` for an instant, in the Asia/Tehran calendar day. */
export function formatJalaliYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')}`;
}

/** `2026-05-01` for an instant, in the Asia/Tehran calendar day. */
export function tehranDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
