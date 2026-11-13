import { renderBarcodeSheetHtml } from "@/lib/api/print-templates-client";
import { RenderBarcodeSheetDto } from "@/types/print-template";

/**
 * شیت برچسب بارکد را از سرور دریافت و در پنجره جدید چاپ باز می‌کند.
 */
export async function printBarcodeSheet(dto: RenderBarcodeSheetDto): Promise<void> {
  const html = await renderBarcodeSheetHtml(dto);
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.print();
}
