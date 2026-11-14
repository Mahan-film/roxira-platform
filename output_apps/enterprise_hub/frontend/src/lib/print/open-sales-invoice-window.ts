import { SALES_INVOICE_A4_TEMPLATE } from "../../print-templates/sales-invoice-a4.template.ts";
import { SALES_INVOICE_A5_TEMPLATE } from "../../print-templates/sales-invoice-a5.template.ts";
import type { InvoiceResponseDto } from "../../types/invoicing.ts";
import type { PrintColumnConfig, PrintTemplateDto } from "../../types/print-template.ts";
import { formatNumber } from "../fa-format.ts";

import { renderTemplate } from "./render-template.ts";
import { mapInvoiceToSalesInvoiceA5Data } from "./sales-invoice-a5.ts";
import { mapInvoiceToSalesInvoiceA4Data, SalesInvoicePrintCustomOptions } from "./sales-invoice.ts";

function escapeHtml(unsafe: unknown): string {
  if (unsafe === null || unsafe === undefined) return "";
  return String(unsafe).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

export function buildDynamicTableHtml(
  invoice: InvoiceResponseDto,
  columnsConfig: PrintColumnConfig[],
): string {
  const visibleCols = [...columnsConfig]
    .filter((c) => c.visible !== false)
    .sort((a, b) => a.order - b.order);

  if (visibleCols.length === 0) return "";

  const getCell = (key: string, item: (typeof invoice.items)[number], index: number) => {
    switch (key) {
      case "rowNumber":
        return `<td class="c">${formatNumber(index + 1)}</td>`;
      case "itemCode":
        return `<td class="n">${escapeHtml(item.sku ?? "")}</td>`;
      case "description":
        return `<td>${escapeHtml(item.description ?? "")}</td>`;
      case "quantity":
        return `<td class="n">${formatNumber(item.quantity)}</td>`;
      case "unit":
        return `<td class="c">${escapeHtml((item as any).unit ?? "")}</td>`;
      case "unitPrice":
        return `<td class="n">${formatNumber(item.unitPrice)}</td>`;
      case "discount":
        return `<td class="n">${formatNumber(item.discount)}</td>`;
      case "vat":
        // The "مالیات و عوارض" column is the line tax AMOUNT, formatted like the other money cells.
        return `<td class="n">${formatNumber(item.tax)}</td>`;
      case "totalPrice":
        return `<td class="n">${formatNumber(item.total)}</td>`;
      default:
        return `<td></td>`;
    }
  };

  const getFooterCell = (key: string) => {
    switch (key) {
      case "rowNumber":
      case "itemCode":
        return `<td></td>`;
      case "description":
        return `<td>جمع</td>`;
      case "quantity":
      case "unit":
        return `<td></td>`;
      case "unitPrice":
        // A sum of line totals does not belong under a unit-price header.
        return `<td></td>`;
      case "discount":
        return `<td class="n">${formatNumber(invoice.totalDiscount)}</td>`;
      case "vat":
        return `<td class="n">${formatNumber(invoice.totalTax)}</td>`;
      case "totalPrice":
        return `<td class="n">${formatNumber(invoice.finalPayable)}</td>`;
      default:
        return `<td></td>`;
    }
  };

  const tableHeaderHtml = visibleCols
    .map(
      (c) =>
        `<th${c.widthPercent ? ` style="width:${c.widthPercent}%;"` : ""}>${escapeHtml(c.label)}</th>`,
    )
    .join("");
  const tableRowsHtml = invoice.items
    .map(
      (item, idx) =>
        `<tr>${visibleCols.map((c) => getCell(c.key, item, idx)).join("")}</tr>`,
    )
    .join("\n");
  const tableFooterHtml = `<tr>${visibleCols.map((c) => getFooterCell(c.key)).join("")}</tr>`;

  return `<table>
    <thead><tr>${tableHeaderHtml}</tr></thead>
    <tbody>\n${tableRowsHtml}\n</tbody>
    <tfoot>${tableFooterHtml}</tfoot>
  </table>`;
}

/** Renders the sales invoice HTML. With no saved template this is the original layout. */
export function buildSalesInvoiceHtml(
  invoice: InvoiceResponseDto,
  statusLabel: string,
  template?: Partial<PrintTemplateDto> | null,
): string {
  // No saved template: the original layout, byte for byte.
  if (!template) {
    return renderTemplate(
      SALES_INVOICE_A4_TEMPLATE,
      mapInvoiceToSalesInvoiceA4Data(invoice, statusLabel),
    );
  }

  const options: SalesInvoicePrintCustomOptions = {
    docTitle: template.options?.headerTitle || undefined,
    logoUrl: template.logoUrl ?? undefined,
    showLogo: template.showLogo,
    footerText: template.options?.footerNote,
    columnsConfig: template.columnsConfig,
  };

  const isA5 = template.paperSize === "A5";
  const isThermal = template.paperSize === "THERMAL_80MM";
  let html = isA5
    ? renderTemplate(SALES_INVOICE_A5_TEMPLATE, {
        ...mapInvoiceToSalesInvoiceA5Data(invoice, statusLabel),
        ...(options.docTitle ? { docTitle: options.docTitle } : {}),
      })
    : renderTemplate(
        SALES_INVOICE_A4_TEMPLATE,
        mapInvoiceToSalesInvoiceA4Data(invoice, statusLabel, options),
      );

  if (
    options?.columnsConfig &&
    Array.isArray(options.columnsConfig) &&
    options.columnsConfig.length > 0
  ) {
    const dynamicTable = buildDynamicTableHtml(invoice, options.columnsConfig);
    if (dynamicTable) {
      html = html.replace(/<table>[\s\S]*?<\/table>/, () => dynamicTable);
    }
  }

  if (isThermal) {
    html = html.replace(
      "</head>",
      `<style>
        @page { size: 80mm auto; margin: 2mm; }
        body { width: 76mm !important; margin: 0 auto !important; font-size: 11px !important; }
        table { font-size: 10px !important; width: 100% !important; }
      </style></head>`,
    );
  }
  return html;
}

/** Opens the sales invoice in its own window and starts printing. Does nothing if a pop-up blocker stops it. */
export function printSalesInvoice(
  invoice: InvoiceResponseDto,
  statusLabel: string,
  template?: Partial<PrintTemplateDto> | null,
): void {
  const html = buildSalesInvoiceHtml(invoice, statusLabel, template);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
