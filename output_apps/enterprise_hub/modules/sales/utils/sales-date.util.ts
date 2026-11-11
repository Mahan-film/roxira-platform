/** Returns current date in Tehran timezone formatted as YYYY-MM-DD */
export function getCurrentTehranDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
}
