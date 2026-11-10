export const DimensionKind = {
  DETAIL: "DETAIL",
  COST_CENTER: "COST_CENTER",
  PROJECT: "PROJECT",
} as const;

export type DimensionKind = (typeof DimensionKind)[keyof typeof DimensionKind];

export const DIMENSION_KIND_LABELS: Record<DimensionKind, string> = {
  [DimensionKind.COST_CENTER]: "مرکز هزینه",
  [DimensionKind.PROJECT]: "مرکز پروژه",
  [DimensionKind.DETAIL]: "تفصیلی شناور",
};

export const DIMENSION_KIND_DESCRIPTIONS: Record<DimensionKind, string> = {
  [DimensionKind.COST_CENTER]: "تخصیص هزینه‌ها به دپارتمان‌ها، شعب، خطوط تولید و واحدهای سازمانی",
  [DimensionKind.PROJECT]: "ردیابی درآمدها و هزینه‌های پروژه‌ها و قراردادهای برون‌سپاری",
  [DimensionKind.DETAIL]: "سطح چهارم حسابداری جهت تفکیک اشخاص، بانک‌ها، صندوق‌ها و سایر حساب‌ها",
};

export interface Dimension {
  id: number;
  tenantId: string;
  kind: DimensionKind;
  code: string;
  name: string;
  parentId: number | null;
  createdAt: string;
}

export interface CreateDimensionInput {
  kind: DimensionKind;
  code: string;
  name: string;
  parentCode?: string;
}

export interface DimensionBalanceRow {
  code: string;
  name: string;
  debit: string;
  credit: string;
  balance: string;
}
