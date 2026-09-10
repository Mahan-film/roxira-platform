export function formatRial(amount: number): string {
  return new Intl.NumberFormat('fa-IR').format(amount) + ' ریال';
}

export function formatPersianDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('fa-IR');
  } catch {
    return isoDate;
  }
}
