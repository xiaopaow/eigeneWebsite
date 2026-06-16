import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCartItems, validateCheckout, validateInquiry, validateProduct } from "../server/validation.js";

test("valid inquiry is normalized", () => {
  const result = validateInquiry({
    name: "  Studio Owner ",
    email: "OWNER@EXAMPLE.COM ",
    gear: "Digitakt and SP-404",
    productSkus: ["PR-W01", "PR-W01", "PR-M02"]
  });
  assert.equal(result.value.email, "owner@example.com");
  assert.deepEqual(result.value.product_skus, ["PR-W01", "PR-M02"]);
  assert.deepEqual(result.value.items, [{ sku: "PR-W01", quantity: 2 }, { sku: "PR-M02", quantity: 1 }]);
});

test("honeypot inquiry is rejected", () => {
  assert.equal(validateInquiry({
    name: "Studio Owner", email: "owner@example.com", gear: "Digitakt", website: "spam"
  }).error, "Submission rejected.");
});

test("product validates publishing fields", () => {
  const result = validateProduct({
    sku: "pr-x01", name: "Test Stand", collection: "Woodline", material: "Wood",
    tier_count: 2, status: "published", price_from: "149"
  });
  assert.equal(result.value.sku, "PR-X01");
  assert.equal(result.value.price_from, 149);
  assert.equal(result.value.direct_checkout, false);
});

test("cart quantities are merged and capped at twenty", () => {
  assert.deepEqual(normalizeCartItems([
    { sku: "pr-w01", quantity: 2 },
    { sku: "PR-W01", quantity: 3 }
  ]).value, [{ sku: "PR-W01", quantity: 5 }]);
  assert.match(normalizeCartItems([{ sku: "PR-W01", quantity: 21 }]).error, /between 1 and 20/i);
});

test("direct checkout requires a fixed price", () => {
  assert.match(validateProduct({
    sku: "PR-X01", name: "Custom Stand", collection: "Woodline", material: "Wood",
    tier_count: 2, status: "published", direct_checkout: "on"
  }).error, /fixed price/i);
});

test("checkout validates customer and quantity fields", () => {
  const result = validateCheckout({
    name: "Studio Owner", email: "owner@example.com", phone: "+1 555 0100",
    country: "United States", address1: "1 Studio Way", city: "Austin", postal_code: "78701",
    items: [{ sku: "PR-W01", quantity: 2 }]
  });
  assert.equal(result.value.items[0].quantity, 2);
});

test("invalid product status is rejected", () => {
  assert.match(validateProduct({
    sku: "PR-X01", name: "Test Stand", collection: "Woodline", material: "Wood",
    tier_count: 2, status: "live"
  }).error, /status/i);
});
