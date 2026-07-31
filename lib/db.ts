import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

declare global {
    var __sqliteDb: Database.Database | undefined;
}

const DB_PATH = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'app.db');

function initSchema(db: Database.Database) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS menu_items (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS modifier_groups (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chefs (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chef_categories (
            chef_id TEXT NOT NULL,
            category_id TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            merchant_order_id TEXT,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders(merchant_order_id);
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

        CREATE TABLE IF NOT EXISTS settings (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shared_carts (
            code TEXT PRIMARY KEY,
            expires_at TEXT NOT NULL,
            data TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shared_carts_expires ON shared_carts(expires_at);

        CREATE TABLE IF NOT EXISTS payment_tokens (
            token TEXT PRIMARY KEY,
            merchant_order_id TEXT,
            amount_rupees REAL NOT NULL,
            visitor_id TEXT,
            consumed INTEGER NOT NULL DEFAULT 0,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_payment_tokens_merchant ON payment_tokens(merchant_order_id);

        CREATE TABLE IF NOT EXISTS admin_sessions (
            id TEXT PRIMARY KEY,
            short_id TEXT UNIQUE NOT NULL,
            ip TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS print_devices (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL,
            last_seen_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0,
            settings TEXT
        );

        CREATE TABLE IF NOT EXISTS print_jobs (
            id TEXT PRIMARY KEY,
            device_id TEXT,
            payload BLOB NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            kind TEXT,
            copies INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            visible_after TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, visible_after, created_at);

        CREATE TABLE IF NOT EXISTS analytics_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_type TEXT NOT NULL,
            ts TEXT NOT NULL,
            data TEXT NOT NULL
        );

        -- Admin debug panel event log. SQLite-backed rather than an
        -- in-memory array — instrumentation.ts (which starts the marketing
        -- scheduler) loads its dependency graph through a separate bundle
        -- from regular API routes, so an in-memory store here would silently
        -- split into two instances that never see each other's writes.
        CREATE TABLE IF NOT EXISTS debug_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            type TEXT NOT NULL,
            phone TEXT,
            ip TEXT,
            allowed INTEGER NOT NULL,
            reason TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_debug_events_ts ON debug_events(ts DESC);

        -- WPS-style ESP32 self-registration. euid_hash is an HMAC of the
        -- device's WiFi MAC — the raw MAC is never stored. device_id links
        -- to print_devices once an admin approves the pending request.
        CREATE TABLE IF NOT EXISTS esp_registrations (
            euid_hash TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            device_id TEXT,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            ip TEXT
        );

        -- WhatsApp marketing: opt-in subscribers, named audience groups,
        -- reusable campaigns (content + target), and automation rules that
        -- fire a campaign for one subject (an order or a phone number) at
        -- most once each.
        CREATE TABLE IF NOT EXISTS marketing_subscribers (
            phone TEXT PRIMARY KEY,
            name TEXT,
            subscribed_at TEXT NOT NULL,
            opted_out_at TEXT,
            source TEXT
        );

        CREATE TABLE IF NOT EXISTS marketing_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS marketing_group_members (
            group_id TEXT NOT NULL,
            phone TEXT NOT NULL,
            PRIMARY KEY (group_id, phone)
        );

        CREATE TABLE IF NOT EXISTS marketing_campaigns (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            message TEXT NOT NULL,
            image_url TEXT,
            link_url TEXT,
            target_group_id TEXT,
            trigger_type TEXT NOT NULL,
            scheduled_at TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            sent_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_campaigns_status_sched ON marketing_campaigns(status, scheduled_at);

        CREATE TABLE IF NOT EXISTS marketing_sends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL,
            phone TEXT NOT NULL,
            status TEXT NOT NULL,
            sent_at TEXT,
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_marketing_sends_campaign ON marketing_sends(campaign_id);

        CREATE TABLE IF NOT EXISTS automation_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            trigger_kind TEXT NOT NULL,
            trigger_params TEXT NOT NULL,
            campaign_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS automation_fired (
            rule_id TEXT NOT NULL,
            subject TEXT NOT NULL,
            fired_at TEXT NOT NULL,
            PRIMARY KEY (rule_id, subject)
        );

        -- WhatsApp inbound: keyword -> reply rules, and the poll-based
        -- ordering conversation state machine (category -> items -> qty).
        CREATE TABLE IF NOT EXISTS whatsapp_auto_replies (
            id TEXT PRIMARY KEY,
            keyword TEXT NOT NULL,
            match_type TEXT NOT NULL,
            response_type TEXT NOT NULL,
            response_text TEXT,
            response_image_url TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS whatsapp_conversations (
            phone TEXT PRIMARY KEY,
            step TEXT NOT NULL,
            selections TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS whatsapp_polls (
            poll_id TEXT PRIMARY KEY,
            phone TEXT NOT NULL,
            kind TEXT NOT NULL,
            context TEXT,
            options TEXT NOT NULL,
            -- Each WhatsApp poll vote is a full snapshot of that voter's
            -- current picks, not a delta — and several polls of the same
            -- kind can be outstanding for one phone at once (one per
            -- selected category, one per selected item), so each poll's
            -- own current tally has to be tracked independently and only
            -- merged into whatsapp_conversations once every poll of that
            -- step has settled.
            current_selection TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            last_vote_at TEXT,
            settled INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_whatsapp_polls_settled ON whatsapp_polls(settled, last_vote_at);
    `);
}

export function getDb(): Database.Database {
    if (globalThis.__sqliteDb) return globalThis.__sqliteDb;

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);

    globalThis.__sqliteDb = db;
    console.log(`[db] SQLite ready at ${DB_PATH}`);
    return db;
}
