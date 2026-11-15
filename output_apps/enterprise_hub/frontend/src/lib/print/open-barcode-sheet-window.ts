import { renderBarcodeSheetHtml } from "@/lib/api/print-templates-client";
import { RenderBarcodeSheetDto } from "@/types/print-template";

/**
 * شیت برچسب بارکد را از سرور دریافت و در پنجره جدید چاپ باز می‌کند.
 */
export async function printBarcodeSheet(dto: RenderBarcodeSheetDto): Promise<void> {
  const totalCount = (dto.items || []).reduce((acc, item) => acc + (item.count ?? 1), 0);
  if (totalCount > 500) {
    throw new Error("حداکثر ۵۰۰ برچسب در یک شیت مجاز است.");
  }

  // Open window synchronously in the user gesture task to avoid popup blockers
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.opener = null;

  try {
    const html = await renderBarcodeSheetHtml(dto);
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow.close();
    printWindow.print();
  } catch (err) {
    printWindow.close();
    throw err;
  }
}
