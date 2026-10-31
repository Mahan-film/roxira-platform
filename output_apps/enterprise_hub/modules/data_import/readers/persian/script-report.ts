/** گزارش حروف/ارقام فارسی در برابر عربی در مجموعه‌ای از متن‌ها (برای یادداشت پیش‌نمایش). */
export interface ScriptReport {
  arabicYeh: number;
  persianYeh: number;
  arabicKaf: number;
  persianKaf: number;
  arabicIndicDigits: number;
  persianDigits: number;
  asciiDigits: number;
  zwnj: number;
  mixedLetters: boolean;
}

export function analyseScript(texts: Iterable<string>): ScriptReport {
  const report: ScriptReport = {
    arabicYeh: 0,
    persianYeh: 0,
    arabicKaf: 0,
    persianKaf: 0,
    arabicIndicDigits: 0,
    persianDigits: 0,
    asciiDigits: 0,
    zwnj: 0,
    mixedLetters: false,
  };
  for (const text of texts) {
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0x064a || code === 0x0649) report.arabicYeh += 1;
      else if (code === 0x06cc) report.persianYeh += 1;
      else if (code === 0x0643) report.arabicKaf += 1;
      else if (code === 0x06a9) report.persianKaf += 1;
      else if (code >= 0x0660 && code <= 0x0669) report.arabicIndicDigits += 1;
      else if (code >= 0x06f0 && code <= 0x06f9) report.persianDigits += 1;
      else if (code >= 0x30 && code <= 0x39) report.asciiDigits += 1;
      else if (code === 0x200c) report.zwnj += 1;
    }
  }
  report.mixedLetters =
    (report.arabicYeh > 0 && report.persianYeh > 0) ||
    (report.arabicKaf > 0 && report.persianKaf > 0);
  return report;
}
