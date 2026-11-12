import type { PrintTemplateDto } from "../../types/print-template.ts";

export interface SalesInvoiceTemplates {
  a4: PrintTemplateDto | null;
  a5: PrintTemplateDto | null;
  thermal: PrintTemplateDto | null;
}

type DefaultFetcher = (paperSize: "A4" | "A5" | "THERMAL_80MM") => Promise<PrintTemplateDto | null>;

/**
 * Loads the tenant's saved default sales-invoice template for each paper size.
 * A size with no saved template is null, and its print button keeps the original layout.
 */
export async function loadSalesInvoiceTemplates(fetchDefault: DefaultFetcher): Promise<SalesInvoiceTemplates> {
  const [a4, a5, thermal] = await Promise.all([
    fetchDefault("A4"),
    fetchDefault("A5"),
    fetchDefault("THERMAL_80MM"),
  ]);
  return { a4, a5, thermal };
}
