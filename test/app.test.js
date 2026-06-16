import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app.js";

process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-tests";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "strong-test-password";
process.env.NODE_ENV = "test";

function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("SELECT sku, price_from")) return { rows: [{ sku: "PR-W01", price_from: "129" }] };
      if (sql.includes("INSERT INTO inquiries")) return { rows: [{ id: 42, created_at: new Date() }] };
      if (sql.includes("status = 'published'")) return { rows: [{ sku: "PR-W01", name: "Angle One", status: "published" }] };
      if (sql.includes("SELECT 1")) return { rows: [{ "?column?": 1 }] };
      return { rows: [], rowCount: 1 };
    }
  };
}

test("public product API only uses published query", async () => {
  const pool = fakePool();
  const response = await request(createApp({ pool, mailer: null })).get("/api/products");
  assert.equal(response.status, 200);
  assert.equal(response.body.products[0].sku, "PR-W01");
  assert.match(pool.calls[0].sql, /status = 'published'/);
});

test("inquiry is stored when SMTP is not configured", async () => {
  const pool = fakePool();
  const response = await request(createApp({ pool, mailer: null }))
    .post("/api/inquiries")
    .send({
      name: "Studio Owner",
      email: "owner@example.com",
      gear: "Digitakt",
      productSkus: ["PR-W01"]
    });
  assert.equal(response.status, 201);
  assert.equal(response.body.inquiryId, 42);
  assert.equal(response.body.emailSent, false);
  assert.ok(pool.calls.some(call => call.sql.includes("INSERT INTO inquiries")));
});

test("inquiry rate limit returns a JSON error", async () => {
  const app = createApp({ pool: fakePool(), mailer: null });
  let response;
  for (let index = 0; index < 6; index += 1) {
    response = await request(app).post("/api/inquiries").send({
      name: "Studio Owner",
      email: "owner@example.com",
      gear: "Digitakt"
    });
  }
  assert.equal(response.status, 429);
  assert.match(response.body.error, /too many requests/i);
});

test("admin product API rejects unauthenticated requests", async () => {
  const response = await request(createApp({ pool: fakePool(), mailer: null }))
    .get("/api/admin/products");
  assert.equal(response.status, 401);
});

test("admin can log in and receive a protected session", async () => {
  const app = createApp({ pool: fakePool(), mailer: null });
  const agent = request.agent(app);
  const login = await agent.post("/api/admin/login").send({
    email: "admin@example.com",
    password: "strong-test-password"
  });
  assert.equal(login.status, 200);
  const session = await agent.get("/api/admin/session");
  assert.equal(session.status, 200);
  assert.equal(session.body.admin, "admin@example.com");
});

test("checkout ignores browser prices and recalculates from the database", async () => {
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM products WHERE sku = ANY")) {
        return { rows: [{
          sku: "PR-W01", name: "Angle One", image_url: "/assets/product-wood.svg",
          price_from: "129.00", direct_checkout: true
        }] };
      }
      if (sql.includes("INSERT INTO orders")) return { rows: [{ id: 7, order_number: params[0] }] };
      return { rows: [], rowCount: 1 };
    }
  };
  const paypal = {
    configured: () => true,
    createOrder: async () => ({ id: "PAYPAL-ORDER-1" }),
    captureOrder: async () => ({}),
    verifyWebhook: async () => true
  };
  const response = await request(createApp({ pool, mailer: null, paypal }))
    .post("/api/checkout/orders")
    .send({
      name: "Studio Owner",
      email: "owner@example.com",
      phone: "+1 555 0100",
      country: "United States",
      address1: "1 Studio Way",
      city: "Austin",
      postal_code: "78701",
      items: [{ sku: "PR-W01", quantity: 2, price: 0 }]
    });
  assert.equal(response.status, 201);
  assert.equal(response.body.paypalOrderId, "PAYPAL-ORDER-1");
  const orderInsert = calls.find(call => call.sql.includes("INSERT INTO orders"));
  const itemInsert = calls.find(call => call.sql.includes("INSERT INTO order_items"));
  assert.equal(orderInsert.params.at(-1), 258);
  assert.equal(itemInsert.params[4], 129);
  assert.equal(itemInsert.params[6], 258);
});

test("checkout rejects products that require a quote", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM products WHERE sku = ANY")) {
        return { rows: [{
          sku: "PR-CUSTOM", name: "Custom Stand", price_from: "299.00", direct_checkout: false
        }] };
      }
      return { rows: [] };
    }
  };
  const paypal = { configured: () => true };
  const response = await request(createApp({ pool, mailer: null, paypal }))
    .post("/api/checkout/orders")
    .send({
      name: "Studio Owner", email: "owner@example.com", phone: "555",
      country: "United States", address1: "1 Studio Way", city: "Austin", postal_code: "78701",
      items: [{ sku: "PR-CUSTOM", quantity: 1 }]
    });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /requires a quote/i);
});
