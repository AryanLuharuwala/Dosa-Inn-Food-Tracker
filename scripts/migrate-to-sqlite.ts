/**
 * One-time migration: local JSON files (data/*.json) → local SQLite (data/app.db)
 *
 * Usage:
 *   npx tsx scripts/migrate-to-sqlite.ts
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db';

const DATA_DIR = path.join(process.cwd(), 'data');

function readJson<T>(name: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8')) as T;
    } catch {
        console.warn(`  [skip] ${name}.json not found`);
        return fallback;
    }
}

function run() {
    const db = getDb();
    const now = new Date().toISOString();

    // ── Categories ──────────────────────────────────────────────────────────────
    const categories = readJson<Record<string, unknown>[]>('categories', []);
    console.log(`Migrating ${categories.length} categories…`);
    const upsertSimple = (table: string) => db.prepare(
        `INSERT INTO ${table} (id, created_at, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`
    );
    const catStmt = upsertSimple('categories');
    for (const c of categories) catStmt.run(c.id as string, now, JSON.stringify({ ...c, createdAt: c.createdAt ?? now, updatedAt: now }));
    console.log('  done\n');

    // ── Menu items ──────────────────────────────────────────────────────────────
    const items = readJson<Record<string, unknown>[]>('menu_items', []);
    console.log(`Migrating ${items.length} menu items…`);
    const itemStmt = upsertSimple('menu_items');
    for (const item of items) itemStmt.run(item.id as string, now, JSON.stringify({ ...item, createdAt: item.createdAt ?? now, updatedAt: now }));
    console.log('  done\n');

    // ── Orders ──────────────────────────────────────────────────────────────────
    const orders = readJson<Record<string, unknown>[]>('orders', []);
    console.log(`Migrating ${orders.length} orders…`);
    const orderStmt = db.prepare(
        `INSERT INTO orders (order_id, merchant_order_id, created_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(order_id) DO NOTHING`
    );
    for (const o of orders) {
        orderStmt.run(o.orderId as string, (o.merchantOrderId as string) ?? null, (o.timestamp as string) ?? now, JSON.stringify(o));
    }
    console.log('  done\n');

    // ── Settings ────────────────────────────────────────────────────────────────
    const settings = readJson<Record<string, unknown>>('settings', {});
    console.log('Migrating settings…');
    db.prepare(
        `INSERT INTO settings (id, data) VALUES ('global', ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`
    ).run(JSON.stringify({
        rushHourMode: settings.rushHourMode ?? false,
        rushHourItems: settings.rushHourItems ?? [],
        restaurantName: settings.restaurantName ?? 'Rocky Da Adda',
        tagline: settings.tagline ?? '100% Pure Veg',
        updatedAt: now,
    }));
    console.log('  done\n');

    // ── Chefs ───────────────────────────────────────────────────────────────────
    const chefs = readJson<Record<string, unknown>[]>('chefs', []);
    console.log(`Migrating ${chefs.length} chefs…`);
    const chefStmt = upsertSimple('chefs');
    for (const chef of chefs) chefStmt.run(chef.id as string, now, JSON.stringify({ ...chef, createdAt: chef.createdAt ?? now, updatedAt: now }));
    console.log('  done\n');

    // ── Chef categories ─────────────────────────────────────────────────────────
    const cc = readJson<Record<string, unknown>[]>('chef_categories', []);
    console.log(`Migrating ${cc.length} chef-category assignments…`);
    if (cc.length > 0) {
        db.prepare('DELETE FROM chef_categories').run();
        const insert = db.prepare('INSERT INTO chef_categories (chef_id, category_id) VALUES (?, ?)');
        for (const row of cc) insert.run(row.chef_id as string, row.category_id as string);
    }
    console.log('  done\n');

    console.log('Migration complete!');
}

run();
