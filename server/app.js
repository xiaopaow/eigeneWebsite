import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import multer from "multer";
import { clearAdminCookie, issueAdminCookie, readAdminSession, requireAdmin, verifyAdminCredentials } from "./auth.js";
import { sendInquiryEmail, sendPaymentEmails } from "./mailer.js";
import { validateCheckout, validateInquiry, validateProduct } from "./validation.js";
import { createPayPalService, paypalIsConfigured } from "./paypal.js";

const root = path.resolve(".");
const uploadDir = path.join(root, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype));
  }
});

const productColumns = [
  "sku", "name", "collection", "material", "tier_count", "tier_label", "device", "angle",
  "fit", "description", "tag", "image_url", "image_alt", "price_from", "footprint",
  "width_cm", "depth_cm", "height_cm", "cable_gap_cm", "load_kg", "status", "sort_order",
  "direct_checkout"
];

const jsonRateLimitHandler = (_req, res) => {
  res.status(429).json({ error: "Too many requests. Please wait a few minutes and try again." });
};

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PR-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function adminListQuery(query, allowedStatuses) {
  const page = Number.parseInt(query.page, 10) || 1;
  const pageSize = Number.parseInt(query.pageSize, 10) || 20;
  const status = String(query.status || "all").toLowerCase();
  const search = String(query.q || "").trim().slice(0, 200);
  if (page < 1 || pageSize < 1 || pageSize > 100) {
    throw Object.assign(new Error("Invalid pagination parameters."), { status: 400 });
  }
  if (status !== "all" && !allowedStatuses.includes(status)) {
    throw Object.assign(new Error("Invalid status filter."), { status: 400 });
  }
  return { page, pageSize, status, search };
}

function paginationResult(requestedPage, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  return { page, pageSize, total, totalPages };
}

function publicBaseUrl(req) {
  return String(process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

async function resolveItems(pool, items, requireDirectCheckout = false) {
  const skus = items.map(item => item.sku);
  const { rows } = await pool.query(
    `SELECT sku, name, image_url, price_from, direct_checkout
     FROM products WHERE sku = ANY($1::text[]) AND status = 'published'`,
    [skus]
  );
  if (rows.length !== skus.length) throw Object.assign(new Error("One or more products are unavailable."), { status: 400 });
  const products = new Map(rows.map(product => [product.sku, product]));
  return items.map(item => {
    const product = products.get(item.sku);
    if (requireDirectCheckout && (!product.direct_checkout || product.price_from == null)) {
      throw Object.assign(new Error(`${product.name} requires a quote before payment.`), { status: 400 });
    }
    const unitPrice = Number(product.price_from || 0);
    return {
      sku: product.sku,
      name: product.name,
      image_url: product.image_url,
      direct_checkout: product.direct_checkout,
      unit_price: unitPrice,
      quantity: item.quantity,
      line_total: Number((unitPrice * item.quantity).toFixed(2))
    };
  });
}

function captureDetails(capture) {
  const purchaseUnit = capture.purchase_units?.[0];
  const payment = purchaseUnit?.payments?.captures?.[0];
  return {
    status: capture.status,
    captureId: payment?.id || null,
    captureStatus: payment?.status || null,
    payerEmail: capture.payer?.email_address || null
  };
}

export function createApp({ pool, mailer, paypal = createPayPalService() }) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:", "https://www.paypalobjects.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://www.paypal.com", "https://www.paypalobjects.com"],
        connectSrc: [
          "'self'",
          "https://www.paypal.com",
          "https://www.sandbox.paypal.com",
          "https://api-m.paypal.com",
          "https://api-m.sandbox.paypal.com"
        ],
        frameSrc: ["'self'", "https://www.paypal.com", "https://www.sandbox.paypal.com"],
        fontSrc: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use("/uploads", express.static(uploadDir, { maxAge: "7d" }));

  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.get("/api/products", async (req, res, next) => {
    try {
      const params = [];
      const where = ["status = 'published'"];
      if (req.query.collection) {
        params.push(req.query.collection);
        where.push(`collection = $${params.length}`);
      }
      const { rows } = await pool.query(
        `SELECT ${productColumns.join(", ")} FROM products
         WHERE ${where.join(" AND ")}
         ORDER BY sort_order ASC, created_at DESC`,
        params
      );
      res.json({ products: rows });
    } catch (error) { next(error); }
  });

  app.post("/api/inquiries", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: jsonRateLimitHandler
  }), async (req, res, next) => {
    const parsed = validateInquiry(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const inquiry = parsed.value;
    try {
      const prices = inquiry.product_skus.length
        ? await pool.query("SELECT sku, price_from FROM products WHERE sku = ANY($1::text[]) AND status = 'published'", [inquiry.product_skus])
        : { rows: [] };
      const total = prices.rows.reduce((sum, product) => sum + Number(product.price_from || 0), 0);
      const quoteItems = prices.rows.map(product => {
        const selected = inquiry.items.find(item => item.sku === product.sku);
        return {
          sku: product.sku,
          quantity: selected?.quantity || 1,
          unit_price: Number(product.price_from || 0)
        };
      });
      const quantityTotal = quoteItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
      const inserted = await pool.query(
        `INSERT INTO inquiries
         (name, email, company, country, gear, notes, product_skus, quote_items, estimated_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
         RETURNING id, created_at`,
        [inquiry.name, inquiry.email, inquiry.company, inquiry.country, inquiry.gear,
          inquiry.notes, JSON.stringify(inquiry.product_skus), JSON.stringify(quoteItems), quantityTotal || total || null]
      );
      let emailSent = false;
      try {
        emailSent = await sendInquiryEmail(mailer, inquiry);
        if (emailSent) await pool.query("UPDATE inquiries SET email_sent = TRUE WHERE id = $1", [inserted.rows[0].id]);
      } catch (error) {
        console.error("Inquiry email failed:", error.message);
      }
      res.status(201).json({
        message: "Thanks. Your fit request has been received.",
        inquiryId: inserted.rows[0].id,
        emailSent
      });
    } catch (error) { next(error); }
  });

  app.get("/api/checkout/config", (_req, res) => {
    res.json({
      enabled: paypal.configured ? paypal.configured() : paypalIsConfigured(),
      clientId: process.env.PAYPAL_CLIENT_ID || null,
      currency: String(process.env.CHECKOUT_CURRENCY || "USD").toUpperCase()
    });
  });

  app.post("/api/checkout/orders", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: jsonRateLimitHandler
  }), async (req, res, next) => {
    const parsed = validateCheckout(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (!(paypal.configured ? paypal.configured() : paypalIsConfigured())) {
      return res.status(503).json({ error: "PayPal checkout is not configured yet." });
    }
    try {
      const customer = parsed.value;
      const items = await resolveItems(pool, customer.items, true);
      const total = Number(items.reduce((sum, item) => sum + item.line_total, 0).toFixed(2));
      const currency = String(process.env.CHECKOUT_CURRENCY || "USD").toUpperCase();
      const number = orderNumber();
      const publicToken = crypto.randomUUID();
      const inserted = await pool.query(
        `INSERT INTO orders
         (order_number, public_token, name, email, phone, country, address1, address2, city,
          region, postal_code, currency, subtotal, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         RETURNING id, order_number`,
        [number, publicToken, customer.name, customer.email, customer.phone, customer.country,
          customer.address1, customer.address2, customer.city, customer.region,
          customer.postal_code, currency, total]
      );
      const internalId = inserted.rows[0].id;
      for (const item of items) {
        await pool.query(
          `INSERT INTO order_items
           (order_id, sku, name, image_url, unit_price, quantity, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [internalId, item.sku, item.name, item.image_url, item.unit_price, item.quantity, item.line_total]
        );
      }
      try {
        const paypalOrder = await paypal.createOrder({
          amount: total.toFixed(2),
          currency,
          orderNumber: number,
          returnUrl: `${publicBaseUrl(req)}/paypal-return`,
          cancelUrl: `${publicBaseUrl(req)}/checkout?paypal=cancelled`
        });
        const approvalUrl = paypalOrder.links?.find(link => ["approve", "payer-action"].includes(link.rel))?.href;
        if (!approvalUrl) throw new Error("PayPal approval link was not returned.");
        await pool.query(
          "UPDATE orders SET paypal_order_id = $1, updated_at = NOW() WHERE id = $2",
          [paypalOrder.id, internalId]
        );
        res.status(201).json({
          paypalOrderId: paypalOrder.id,
          approvalUrl,
          orderNumber: number,
          publicToken
        });
      } catch (error) {
        await pool.query("UPDATE orders SET status = 'failed', updated_at = NOW() WHERE id = $1", [internalId]);
        throw error;
      }
    } catch (error) { next(error); }
  });

  app.post("/api/checkout/orders/:paypalOrderId/capture", async (req, res, next) => {
    try {
      const existing = await pool.query(
        "SELECT * FROM orders WHERE paypal_order_id = $1",
        [req.params.paypalOrderId]
      );
      const order = existing.rows[0];
      if (!order) return res.status(404).json({ error: "Order not found." });
      if (order.status === "paid") {
        return res.json({ status: "paid", orderNumber: order.order_number, publicToken: order.public_token });
      }
      const captured = await paypal.captureOrder(req.params.paypalOrderId);
      const details = captureDetails(captured);
      if (details.status !== "COMPLETED" && details.captureStatus !== "COMPLETED") {
        await pool.query("UPDATE orders SET status = 'failed', updated_at = NOW() WHERE id = $1", [order.id]);
        return res.status(402).json({ error: "PayPal did not complete the payment." });
      }
      const updated = await pool.query(
        `UPDATE orders SET status = 'paid', paypal_capture_id = $1, payer_email = $2,
         paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [details.captureId, details.payerEmail, order.id]
      );
      const items = (await pool.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [order.id])).rows;
      try {
        const sent = await sendPaymentEmails(mailer, updated.rows[0], items);
        if (sent) await pool.query("UPDATE orders SET payment_email_sent = TRUE WHERE id = $1", [order.id]);
      } catch (error) {
        console.error("Payment email failed:", error.message);
      }
      res.json({ status: "paid", orderNumber: order.order_number, publicToken: order.public_token });
    } catch (error) { next(error); }
  });

  app.get("/api/checkout/orders/:orderNumber", async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT order_number, status, currency, total, created_at, paid_at
         FROM orders WHERE order_number = $1 AND public_token = $2`,
        [req.params.orderNumber, req.query.token]
      );
      if (!rows[0]) return res.status(404).json({ error: "Order not found." });
      res.json({ order: rows[0] });
    } catch (error) { next(error); }
  });

  app.post("/api/paypal/webhook", async (req, res, next) => {
    try {
      if (!await paypal.verifyWebhook(req.headers, req.body)) {
        return res.status(400).json({ error: "Invalid PayPal webhook signature." });
      }
      const event = req.body;
      const saved = await pool.query(
        `INSERT INTO payment_events (event_id, event_type, payload)
         VALUES ($1,$2,$3::jsonb) ON CONFLICT (event_id) DO NOTHING`,
        [event.id, event.event_type, JSON.stringify(event)]
      );
      if (!saved.rowCount) return res.json({ received: true, duplicate: true });
      const relatedOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
      const captureId = event.resource?.id;
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        await pool.query(
          `UPDATE orders SET status = 'paid', paypal_capture_id = COALESCE(paypal_capture_id, $1),
           paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
           WHERE paypal_order_id = $2 OR paypal_capture_id = $1`,
          [captureId, relatedOrderId]
        );
      } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
        await pool.query(
          "UPDATE orders SET status = 'refunded', updated_at = NOW() WHERE paypal_capture_id = $1",
          [event.resource?.links?.find(link => link.rel === "up")?.href?.split("/").pop() || captureId]
        );
      } else if (event.event_type === "CUSTOMER.DISPUTE.CREATED") {
        const disputedCapture = event.resource?.disputed_transactions?.[0]?.seller_transaction_id;
        if (disputedCapture) {
          await pool.query("UPDATE orders SET status = 'disputed', updated_at = NOW() WHERE paypal_capture_id = $1", [disputedCapture]);
        }
      }
      res.json({ received: true });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: jsonRateLimitHandler
  }), async (req, res) => {
    if (!await verifyAdminCredentials(req.body.email, req.body.password)) {
      return res.status(401).json({ error: "Invalid login." });
    }
    issueAdminCookie(res, String(req.body.email).toLowerCase());
    res.json({ message: "Signed in." });
  });

  app.post("/api/admin/logout", (_req, res) => {
    clearAdminCookie(res);
    res.json({ message: "Signed out." });
  });
  app.get("/api/admin/session", (req, res) => {
    const session = readAdminSession(req);
    res.json(session ? { authenticated: true, admin: session.sub } : { authenticated: false });
  });

  app.get("/api/admin/products", requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, ${productColumns.join(", ")}, created_at, updated_at
         FROM products ORDER BY sort_order ASC, created_at DESC`
      );
      res.json({ products: rows });
    } catch (error) { next(error); }
  });

  app.post("/api/admin/products", requireAdmin, async (req, res, next) => {
    const parsed = validateProduct(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
      const values = productColumns.map(key => parsed.value[key]);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
      const { rows } = await pool.query(
        `INSERT INTO products (${productColumns.join(",")}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      res.status(201).json({ product: rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That SKU already exists." });
      next(error);
    }
  });

  app.put("/api/admin/products/:id", requireAdmin, async (req, res, next) => {
    const parsed = validateProduct(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
      const values = productColumns.map(key => parsed.value[key]);
      const assignments = productColumns.map((key, index) => `${key} = $${index + 1}`).join(",");
      values.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE products SET ${assignments}, updated_at = NOW()
         WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows[0]) return res.status(404).json({ error: "Product not found." });
      res.json({ product: rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That SKU already exists." });
      next(error);
    }
  });

  app.delete("/api/admin/products/:id", requireAdmin, async (req, res, next) => {
    try {
      const { rowCount } = await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: "Product not found." });
      res.status(204).end();
    } catch (error) { next(error); }
  });

  app.post("/api/admin/upload", requireAdmin, upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Choose a JPG, PNG, WebP, or AVIF image under 5 MB." });
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });

  app.get("/api/admin/inquiries", requireAdmin, async (req, res, next) => {
    try {
      const options = adminListQuery(req.query, ["new", "contacted", "closed", "spam"]);
      const params = [];
      const where = [];
      if (options.status !== "all") {
        params.push(options.status);
        where.push(`status = $${params.length}`);
      }
      if (options.search) {
        params.push(`%${options.search}%`);
        const token = `$${params.length}`;
        where.push(`(id::text ILIKE ${token} OR name ILIKE ${token} OR email ILIKE ${token}
          OR company ILIKE ${token} OR country ILIKE ${token} OR gear ILIKE ${token}
          OR notes ILIKE ${token} OR product_skus::text ILIKE ${token})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countResult, summaryResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM inquiries ${whereSql}`, params),
        pool.query(`SELECT
          (COUNT(*) FILTER (WHERE status = 'new'))::int AS new_count,
          (COUNT(*) FILTER (WHERE status = 'contacted'))::int AS contacted_count,
          (COUNT(*) FILTER (WHERE status = 'closed'))::int AS closed_count,
          (COUNT(*) FILTER (WHERE email_sent))::int AS emailed_count
          FROM inquiries`)
      ]);
      const total = Number(countResult.rows[0]?.total || 0);
      const pagination = paginationResult(options.page, options.pageSize, total);
      const listParams = [...params, pagination.pageSize, (pagination.page - 1) * pagination.pageSize];
      const { rows } = await pool.query(
        `SELECT * FROM inquiries ${whereSql} ORDER BY created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );
      const summary = summaryResult.rows[0] || {};
      res.json({
        inquiries: rows,
        pagination,
        summary: {
          newCount: Number(summary.new_count || 0),
          contactedCount: Number(summary.contacted_count || 0),
          closedCount: Number(summary.closed_count || 0),
          emailedCount: Number(summary.emailed_count || 0)
        }
      });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/orders", requireAdmin, async (req, res, next) => {
    try {
      const options = adminListQuery(req.query, ["pending", "approved", "paid", "failed", "refunded", "disputed"]);
      const params = [];
      const where = [];
      if (options.status !== "all") {
        params.push(options.status);
        where.push(`o.status = $${params.length}`);
      }
      if (options.search) {
        params.push(`%${options.search}%`);
        const token = `$${params.length}`;
        where.push(`(o.order_number ILIKE ${token} OR o.name ILIKE ${token} OR o.email ILIKE ${token}
          OR o.phone ILIKE ${token} OR o.country ILIKE ${token} OR o.city ILIKE ${token}
          OR o.region ILIKE ${token} OR o.postal_code ILIKE ${token}
          OR o.paypal_order_id ILIKE ${token} OR o.paypal_capture_id ILIKE ${token}
          OR o.payer_email ILIKE ${token} OR EXISTS (
            SELECT 1 FROM order_items oi_search WHERE oi_search.order_id = o.id
            AND (oi_search.sku ILIKE ${token} OR oi_search.name ILIKE ${token})
          ))`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const [countResult, summaryResult] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM orders o ${whereSql}`, params),
        pool.query(`SELECT
          COALESCE(SUM(total) FILTER (WHERE status = 'paid'), 0) AS paid_total,
          (COUNT(*) FILTER (WHERE status = 'paid'))::int AS paid_count,
          (COUNT(*) FILTER (WHERE status IN ('pending', 'approved')))::int AS pending_count,
          MAX(paid_at) FILTER (WHERE status = 'paid') AS latest_paid
          FROM orders`)
      ]);
      const total = Number(countResult.rows[0]?.total || 0);
      const pagination = paginationResult(options.page, options.pageSize, total);
      const listParams = [...params, pagination.pageSize, (pagination.page - 1) * pagination.pageSize];
      const { rows } = await pool.query(`
        SELECT o.*,
          COALESCE((
            SELECT json_agg(json_build_object(
              'sku', oi.sku, 'name', oi.name, 'image_url', oi.image_url, 'quantity', oi.quantity,
              'unit_price', oi.unit_price, 'line_total', oi.line_total
            ) ORDER BY oi.id)
            FROM order_items oi WHERE oi.order_id = o.id
          ), '[]'::json) AS items
        FROM orders o ${whereSql} ORDER BY o.created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
      `, listParams);
      const summary = summaryResult.rows[0] || {};
      res.json({
        orders: rows,
        pagination,
        summary: {
          paidTotal: Number(summary.paid_total || 0),
          paidCount: Number(summary.paid_count || 0),
          pendingCount: Number(summary.pending_count || 0),
          latestPaid: summary.latest_paid || null
        }
      });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/inquiries/:id", requireAdmin, async (req, res, next) => {
    if (!["new", "contacted", "closed", "spam"].includes(req.body.status)) {
      return res.status(400).json({ error: "Invalid inquiry status." });
    }
    try {
      const { rows } = await pool.query(
        "UPDATE inquiries SET status = $1 WHERE id = $2 RETURNING *",
        [req.body.status, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: "Inquiry not found." });
      res.json({ inquiry: rows[0] });
    } catch (error) { next(error); }
  });

  app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));
  app.get("/admin", (_req, res) => res.sendFile(path.join(root, "public", "admin.html")));
  app.use((error, _req, res, _next) => {
    if (!error.status || error.status >= 500) console.error(error);
    if (error instanceof multer.MulterError) return res.status(400).json({ error: error.message });
    res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong. Please try again." });
  });
  return app;
}
