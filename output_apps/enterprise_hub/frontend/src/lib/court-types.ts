/** انواع دادگاه/مرجع قابل انتخاب در پیش‌نویس رأی (منطبق با court_type بک‌اند). */
export type RulingCourtType =
  | "general_civil"
  | "peace"
  | "criminal_1"
  | "criminal_2"
  | "revolution"
  | "guild_violations"
  | "computer_guild"
  | "bar_disciplinary"
  | "civil"
  | "criminal"
  | "family"
  | "commercial"
  | "labor"
  | "administrative";

export interface CourtTypeOption {
  value: RulingCourtType;
  label: string;
}

export interface CourtTypeGroup {
  label: string;
  courts: CourtTypeOption[];
}

export const COURT_TYPE_GROUPS: CourtTypeGroup[] = [
  {
    label: "دادسرا",
    courts: [{ value: "revolution", label: "دادسرا و دادگاه انقلاب" }],
  },
  {
    label: "کیفری",
    courts: [
      { value: "criminal", label: "دادگاه کیفری (عمومی)" },
      { value: "criminal_1", label: "دادگاه کیفری یک" },
      { value: "criminal_2", label: "دادگاه کیفری دو" },
    ],
  },
  {
    label: "حقوقی",
    courts: [
      { value: "civil", label: "دادگاه حقوقی" },
      { value: "general_civil", label: "دادگاه عمومی حقوقی" },
      { value: "peace", label: "شورای حل اختلاف / صلح" },
    ],
  },
  {
    label: "خانواده، کار و تجاری",
    courts: [
      { value: "family", label: "دادگاه خانواده" },
      { value: "labor", label: "مرجع حل اختلاف کار" },
      { value: "commercial", label: "دادگاه تجاری" },
    ],
  },
  {
    label: "اداری",
    courts: [{ value: "administrative", label: "دیوان عدالت اداری" }],
  },
  {
    label: "صنفی و انتظامی",
    courts: [
      { value: "guild_violations", label: "تعزیرات و تخلفات صنفی" },
      { value: "computer_guild", label: "نظام صنفی رایانه‌ای" },
      { value: "bar_disciplinary", label: "دادسرا و دادگاه انتظامی وکلا" },
    ],
  },
];

export const ALL_COURT_TYPES: CourtTypeOption[] = COURT_TYPE_GROUPS.flatMap((g) => g.courts);

export function isRulingCourtType(v: string): v is RulingCourtType {
  return ALL_COURT_TYPES.some((c) => c.value === v);
}

export function courtLabel(v: string): string {
  return ALL_COURT_TYPES.find((c) => c.value === v)?.label ?? v;
}
