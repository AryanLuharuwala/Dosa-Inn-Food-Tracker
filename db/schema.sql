-- Dosa Inn / Rocky Da Adda — PostgreSQL schema
-- Run once against Azure Database for PostgreSQL Flexible Server
-- psql "$DATABASE_URL" -f db/schema.sql

-- ── Categories ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tagline     TEXT,
    icon        TEXT NOT NULL DEFAULT '🍽️',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Menu items ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menu_items (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    price        INTEGER NOT NULL,   -- paisa (1 INR = 100 paisa)
    category_id  TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    tags         TEXT[] DEFAULT '{}',
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    image        TEXT,
    add_ons      JSONB NOT NULL DEFAULT '[]',   -- [{id,name,price}]
    extras       JSONB NOT NULL DEFAULT '[]',   -- [{id,name,price}]
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category  ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items(is_available);

-- ── Orders ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
    order_id         TEXT PRIMARY KEY,
    order_type       TEXT NOT NULL DEFAULT 'dine-in',  -- 'dine-in' | 'preorder'
    table_number     TEXT,
    token_number     INTEGER,
    preorder_details JSONB,          -- {pickupTime, customerName, customerPhone}
    items            JSONB NOT NULL DEFAULT '[]',
    extras           JSONB NOT NULL DEFAULT '[]',
    total_amount     INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'pending',  -- pending|preparing|ready|delivered
    token_id         TEXT,
    phone_pe_order_id TEXT,
    customer_phone   TEXT,
    customer_name    TEXT,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- ── Settings ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT 'null',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults
INSERT INTO settings (key, value) VALUES
    ('rushHourMode',    'false'),
    ('rushHourItems',   '[]'),
    ('restaurantName',  '"Rocky Da Adda"'),
    ('tagline',         '"100% Pure Veg"')
ON CONFLICT (key) DO NOTHING;

-- ── Chefs ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chefs (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    color      TEXT NOT NULL DEFAULT '#4CAF50',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Chef ↔ Category assignments ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chef_categories (
    chef_id     TEXT NOT NULL REFERENCES chefs(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (chef_id, category_id)
);

-- ── Shared carts ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_carts (
    code         TEXT PRIMARY KEY,
    table_number TEXT NOT NULL,
    token_number INTEGER NOT NULL,
    participants JSONB NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_carts_expires ON shared_carts(expires_at);

-- ── Payment tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_tokens (
    token             TEXT PRIMARY KEY,
    amount_rupees     NUMERIC(10,2) NOT NULL,
    visitor_id        TEXT NOT NULL,
    merchant_order_id TEXT NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,
    consumed          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_tokens_expires ON payment_tokens(expires_at);

-- ── Analytics logs ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_logs (
    id         BIGSERIAL PRIMARY KEY,
    log_type   TEXT NOT NULL,   -- 'order' | 'payment' | 'cancellation' | 'cart_abandonment'
    entry      JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_type    ON analytics_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_logs_created ON analytics_logs(created_at DESC);

-- ── PhonePe OAuth token cache ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS phonepe_token_cache (
    key        TEXT PRIMARY KEY DEFAULT 'access_token',
    token      TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
