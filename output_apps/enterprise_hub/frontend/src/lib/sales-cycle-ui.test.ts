import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoiceFromDeliveryUrl,
  canConvertQuotation,
  canCreateDeliveryFromOrder,
} from "./sales-cycle-ui.ts";

describe("sales-cycle-ui helpers", () => {
  it("builds invoice-from-delivery URL with encoded params", () => {
    const url = buildInvoiceFromDeliveryUrl({ id: 42, partyCode: "C-100" });
    assert.equal(url, "/app/invoicing?new=1&deliveryId=42&partyCode=C-100");
  });

  it("allows converting draft/sent/accepted quotations only", () => {
    assert.equal(canConvertQuotation("DRAFT"), true);
    assert.equal(canConvertQuotation("SENT"), true);
    assert.equal(canConvertQuotation("ACCEPTED"), true);
    assert.equal(canConvertQuotation("CONVERTED"), false);
    assert.equal(canConvertQuotation("CANCELLED"), false);
  });

  it("allows creating delivery only for confirmed or partially delivered orders", () => {
    assert.equal(canCreateDeliveryFromOrder("CONFIRMED"), true);
    assert.equal(canCreateDeliveryFromOrder("PARTIALLY_DELIVERED"), true);
    assert.equal(canCreateDeliveryFromOrder("DRAFT"), false);
    assert.equal(canCreateDeliveryFromOrder("DELIVERED"), false);
  });
});
