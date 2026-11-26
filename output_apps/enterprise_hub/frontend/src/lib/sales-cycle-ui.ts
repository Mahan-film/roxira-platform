import type { SalesDelivery, SalesOrderStatus, SalesQuotationStatus } from "@/types/sales";

export function buildInvoiceFromDeliveryUrl(
  delivery: Pick<SalesDelivery, "id" | "partyCode">,
): string {
  const params = new URLSearchParams({
    new: "1",
    deliveryId: String(delivery.id),
    partyCode: delivery.partyCode,
  });
  return `/app/invoicing?${params.toString()}`;
}

export function canConvertQuotation(status: SalesQuotationStatus): boolean {
  return status === "DRAFT" || status === "SENT" || status === "ACCEPTED";
}

export function canCreateDeliveryFromOrder(status: SalesOrderStatus): boolean {
  return status === "CONFIRMED" || status === "PARTIALLY_DELIVERED";
}
