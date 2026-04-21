/**
 * One-time migration: local JSON files → Azure PostgreSQL
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-to-azure.ts
 *
 * Run this ONCE from your local machine (or any machine with access to both
 * the JSON files in /data/ and the Azure PostgreSQL server).
 */

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const DATA_DIR = path.join(process.cwd(), 'data');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

function readJson<T>(name: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8')) as T;
    } catch {
        console.warn(`  [skip] ${name}.json not found`);
        return fallback;
    }
}

async function run() {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL\n');

    try {
        // ── Categories ──────────────────────────────────────────────────────────
        const categories = readJson<Record<string, unknown>[]>('categories', []);
        console.log(`Migrating ${categories.length} categories…`);
        for (const c of categories) {
            await client.query(
                `INSERT INTO categories (id, name, tagline, icon, sort_order)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (id) DO UPDATE SET name=$2, tagline=$3, icon=$4, sort_order=$5`,
                [c.id, c.name, c.tagline ?? null, c.icon ?? '🍽️', c.sortOrder ?? 0]
            );
        }
        console.log('  done\n');

        // ── Menu items ──────────────────────────────────────────────────────────
        const items = readJson<Record<string, unknown>[]>('menu_items', []);
        console.log(`Migrating ${items.length} menu items…`);
        for (const item of items) {
            await client.query(
                `INSERT INTO menu_items (id, name, description, price, category_id, tags, is_available, image, add_ons, extras)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                 ON CONFLICT (id) DO UPDATE SET
                   name=$2, description=$3, price=$4, category_id=$5, tags=$6,
                   is_available=$7, image=$8, add_ons=$9, extras=$10`,
                [
                    item.id, item.name, item.description ?? '',
                    item.price, item.categoryId ?? '',
                    item.tags ?? [],
                    item.isAvailable ?? true,
                    item.image ?? null,
                    JSON.stringify(item.addOns ?? []),
                    JSON.stringify(item.extras ?? []),
                ]
            );
        }
        console.log('  done\n');

        // ── Orders ──────────────────────────────────────────────────────────────
        const orders = readJson<Record<string, unknown>[]>('orders', []);
        console.log(`Migrating ${orders.length} orders…`);
        for (const o of orders) {
            await client.query(
                `INSERT INTO orders
                    (order_id, order_type, table_number, token_number, preorder_details,
                     items, extras, total_amount, status, token_id, phone_pe_order_id,
                     customer_phone, customer_name, timestamp)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                 ON CONFLICT (order_id) DO NOTHING`,
                [
                    o.orderId, o.orderType ?? 'dine-in', o.tableNumber ?? null,
                    o.tokenNumber ?? null,
                    o.preorderDetails ? JSON.stringify(o.preorderDetails) : null,
                    JSON.stringify(o.items ?? []), JSON.stringify(o.extras ?? []),
                    o.totalAmount ?? 0, o.status ?? 'pending',
                    o.tokenId ?? null, o.phonePeOrderId ?? null,
                    o.customerPhone ?? null, o.customerName ?? null,
                    o.timestamp ?? new Date().toISOString(),
                ]
            );
        }
        console.log('  done\n');

        // ── Settings ────────────────────────────────────────────────────────────
        const settings = readJson<Record<string, unknown>>('settings', {});
        console.log('Migrating settings…');
        const settingsEntries: [string, unknown][] = [
            ['rushHourMode', settings.rushHourMode ?? false],
            ['rushHourItems', settings.rushHourItems ?? []],
            ['restaurantName', settings.restaurantName ?? 'Rocky Da Adda'],
            ['tagline', settings.tagline ?? '100% Pure Veg'],
        ];
        for (const [key, value] of settingsEntries) {
            await client.query(
                `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
                [key, JSON.stringify(value)]
            );
        }
        console.log('  done\n');

        // ── Chefs ───────────────────────────────────────────────────────────────
        const chefs = readJson<Record<string, unknown>[]>('chefs', []);
        console.log(`Migrating ${chefs.length} chefs…`);
        for (const chef of chefs) {
            await client.query(
                `INSERT INTO chefs (id, name, is_active, color)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (id) DO UPDATE SET name=$2, is_active=$3, color=$4`,
                [chef.id, chef.name, chef.is_active ?? true, chef.color ?? '#4CAF50']
            );
        }
        console.log('  done\n');

        // ── Chef categories ─────────────────────────────────────────────────────
        const cc = readJson<Record<string, unknown>[]>('chef_categories', []);
        console.log(`Migrating ${cc.length} chef-category assignments…`);
        for (const row of cc) {
            await client.query(
                `INSERT INTO chef_categories (chef_id, category_id)
                 VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                [row.chef_id, row.category_id]
            );
        }
        console.log('  done\n');

        console.log('Migration complete!');
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
});
