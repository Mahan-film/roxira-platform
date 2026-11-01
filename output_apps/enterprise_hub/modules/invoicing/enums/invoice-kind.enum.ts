/** Which side of the trade this invoice is on. */
export enum InvoiceDirection {
  /** We issue it to a customer. */
  SALE = 'SALE',
  /** A supplier issued it to us. */
  PURCHASE = 'PURCHASE',
}

/** Iranian e-invoice type (Moadian `inty`). */
export enum EInvoiceType {
  WITH_BUYER = 1,
  WITHOUT_BUYER = 2,
  RETAIL = 3,
}

/** Iranian e-invoice subject (Moadian `ins`). */
export enum InvoiceSubject {
  ORIGINAL = 1,
  CORRECTIVE = 2,
  CANCEL = 3,
  RETURN = 4,
}

export const INVOICE_DIRECTION_LABELS: Record<InvoiceDirection, string> = {
  [InvoiceDirection.SALE]: 'فروش',
  [InvoiceDirection.PURCHASE]: 'خرید',
};

export const EINVOICE_TYPE_LABELS: Record<EInvoiceType, string> = {
  [EInvoiceType.WITH_BUYER]: 'نوع اول (با مشخصات خریدار)',
  [EInvoiceType.WITHOUT_BUYER]: 'نوع دوم (بدون مشخصات خریدار)',
  [EInvoiceType.RETAIL]: 'نوع سوم (فروشگاهی)',
};

export const INVOICE_SUBJECT_LABELS: Record<InvoiceSubject, string> = {
  [InvoiceSubject.ORIGINAL]: 'اصلی',
  [InvoiceSubject.CORRECTIVE]: 'اصلاحی',
  [InvoiceSubject.CANCEL]: 'ابطالی',
  [InvoiceSubject.RETURN]: 'برگشت از فروش/خرید',
};
