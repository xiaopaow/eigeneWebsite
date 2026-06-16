import pg from "pg";

const { Pool } = pg;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new Pool({
    connectionString,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false
  });
}

export async function initializeDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      sku VARCHAR(64) UNIQUE NOT NULL,
      name VARCHAR(160) NOT NULL,
      collection VARCHAR(80) NOT NULL,
      material VARCHAR(80) NOT NULL,
      tier_count INTEGER NOT NULL DEFAULT 1 CHECK (tier_count BETWEEN 1 AND 12),
      tier_label VARCHAR(80) NOT NULL DEFAULT '1-tier',
      device TEXT NOT NULL DEFAULT '',
      angle VARCHAR(160) NOT NULL DEFAULT '',
      fit TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      tag VARCHAR(100) NOT NULL DEFAULT '',
      image_url TEXT,
      image_alt VARCHAR(240) NOT NULL DEFAULT '',
      price_from NUMERIC(12,2),
      footprint VARCHAR(40) NOT NULL DEFAULT 'Medium',
      width_cm NUMERIC(8,2),
      depth_cm NUMERIC(8,2),
      height_cm NUMERIC(8,2),
      cable_gap_cm NUMERIC(8,2),
      load_kg NUMERIC(8,2),
      status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
      direct_checkout BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      company VARCHAR(160) NOT NULL DEFAULT '',
      country VARCHAR(120) NOT NULL DEFAULT '',
      gear TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      product_skus JSONB NOT NULL DEFAULT '[]'::jsonb,
      quote_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      estimated_total NUMERIC(12,2),
      status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed','spam')),
      email_sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products ADD COLUMN IF NOT EXISTS direct_checkout BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS quote_items JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_number VARCHAR(40) UNIQUE NOT NULL,
      public_token UUID UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      phone VARCHAR(60) NOT NULL,
      country VARCHAR(120) NOT NULL,
      address1 VARCHAR(180) NOT NULL,
      address2 VARCHAR(180) NOT NULL DEFAULT '',
      city VARCHAR(120) NOT NULL,
      region VARCHAR(120) NOT NULL DEFAULT '',
      postal_code VARCHAR(40) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'USD',
      subtotal NUMERIC(12,2) NOT NULL,
      shipping_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL,
      shipping_included BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','paid','failed','refunded','disputed')),
      paypal_order_id VARCHAR(80) UNIQUE,
      paypal_capture_id VARCHAR(80),
      payer_email VARCHAR(254),
      payment_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      sku VARCHAR(64) NOT NULL,
      name VARCHAR(160) NOT NULL,
      image_url TEXT,
      unit_price NUMERIC(12,2) NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
      line_total NUMERIC(12,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_events (
      event_id VARCHAR(120) PRIMARY KEY,
      event_type VARCHAR(120) NOT NULL,
      payload JSONB NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS products_public_idx
      ON products(status, sort_order, created_at DESC);
    CREATE INDEX IF NOT EXISTS inquiries_created_idx
      ON inquiries(created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_created_idx
      ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS order_items_order_idx
      ON order_items(order_id);

    ALTER TABLE products ALTER COLUMN status SET DEFAULT 'published';
  `);
}
