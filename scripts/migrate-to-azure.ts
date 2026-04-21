/**
 * One-time migration: local JSON files → Cosmos DB for MongoDB
 *
 * Usage:
 *   MONGO_URL="mongodb://..." npx tsx scripts/migrate-to-azure.ts
 */

import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

const DATA_DIR = path.join(process.cwd(), 'data');
const uri = process.env.MONGO_URL!;
const dbName = process.env.MONGO_DB_NAME ?? 'pollys-database';

function readJson<T>(name: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8')) as T;
    } catch {
        console.warn(`  [skip] ${name}.json not found`);
        return fallback;
    }
}

async function run() {
    const client = new MongoClient(uri, { tls: true, retryWrites: false });
    await client.connect();
    const db = client.db(dbName);
    console.log('Connected to Cosmos DB\n');

    // ── Categories ──────────────────────────────────────────────────────────────
    const categories = readJson<Record<string, unknown>[]>('categories', []);
    console.log(`Migrating ${categories.length} categories…`);
    for (const c of categories) {
        await db.collection('categories').updateOne(
            { id: c.id },
            { $set: { ...c, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
        );
    }
    console.log('  done\n');

    // ── Menu items ──────────────────────────────────────────────────────────────
    const items = readJson<Record<string, unknown>[]>('menu_items', []);
    console.log(`Migrating ${items.length} menu items…`);
    for (const item of items) {
        await db.collection('menu_items').updateOne(
            { id: item.id },
            { $set: { ...item, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
        );
    }
    console.log('  done\n');

    // ── Orders ──────────────────────────────────────────────────────────────────
    const orders = readJson<Record<string, unknown>[]>('orders', []);
    console.log(`Migrating ${orders.length} orders…`);
    for (const o of orders) {
        await db.collection('orders').updateOne(
            { orderId: o.orderId },
            { $setOnInsert: { ...o, createdAt: new Date() } },
            { upsert: true }
        );
    }
    console.log('  done\n');

    // ── Settings ────────────────────────────────────────────────────────────────
    const settings = readJson<Record<string, unknown>>('settings', {});
    console.log('Migrating settings…');
    await db.collection('settings').updateOne(
        { _id: 'global' as unknown as import('mongodb').ObjectId },
        {
            $set: {
                rushHourMode: settings.rushHourMode ?? false,
                rushHourItems: settings.rushHourItems ?? [],
                restaurantName: settings.restaurantName ?? 'Rocky Da Adda',
                tagline: settings.tagline ?? '100% Pure Veg',
                updatedAt: new Date(),
            }
        },
        { upsert: true }
    );
    console.log('  done\n');

    // ── Chefs ───────────────────────────────────────────────────────────────────
    const chefs = readJson<Record<string, unknown>[]>('chefs', []);
    console.log(`Migrating ${chefs.length} chefs…`);
    for (const chef of chefs) {
        await db.collection('chefs').updateOne(
            { id: chef.id },
            { $set: { ...chef, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
        );
    }
    console.log('  done\n');

    // ── Chef categories ─────────────────────────────────────────────────────────
    const cc = readJson<Record<string, unknown>[]>('chef_categories', []);
    console.log(`Migrating ${cc.length} chef-category assignments…`);
    if (cc.length > 0) {
        await db.collection('chef_categories').deleteMany({});
        await db.collection('chef_categories').insertMany(cc);
    }
    console.log('  done\n');

    console.log('Migration complete!');
    await client.close();
}

run().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});
