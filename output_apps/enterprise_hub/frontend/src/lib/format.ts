export function formatRial(amount: number): string {
  return new Intl.NumberFormat('fa-IR').format(amount) + ' ریال';
}

export function formatPersianDate(isoDate?: string | null): string {
  if (!isoDate) {
    return "—";
  }
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  try {
    return date.toLocaleDateString("fa-IR");
  } catch {
    return isoDate;
  }
}
