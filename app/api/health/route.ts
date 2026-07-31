import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const TABLES = [
    'categories', 'menu_items', 'modifier_groups', 'chefs', 'chef_categories',
    'orders', 'settings', 'shared_carts', 'payment_tokens', 'admin_sessions',
    'print_devices', 'print_jobs', 'analytics_logs',
];

export async function GET() {
    const env = {
        SQLITE_PATH: process.env.SQLITE_PATH || '(default: data/app.db)',
        AZURE_STORAGE_CONNECTION_STRING_set: !!process.env.AZURE_STORAGE_CONNECTION_STRING,
        AZURE_STORAGE_CONTAINER_NAME: process.env.AZURE_STORAGE_CONTAINER_NAME ?? '(default: uploads)',
    };

    try {
        const db = getDb();
        const counts: Record<string, number> = {};
        for (const table of TABLES) {
            const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
            counts[table] = row.n;
        }

        // Sample one menu_item to see the actual document shape
        const sample = db.prepare('SELECT data FROM menu_items LIMIT 1').get() as { data: string } | undefined;
        const sampleMenuItem = sample ? JSON.parse(sample.data) : null;

        return NextResponse.json({
            ok: true, env, tables: counts,
            sampleMenuItem: sampleMenuItem ? {
                id: sampleMenuItem.id,
                price: sampleMenuItem.price,
                isAvailable: sampleMenuItem.isAvailable,
                updatedAt: sampleMenuItem.updatedAt,
                keys: Object.keys(sampleMenuItem),
            } : null,
        });
    } catch (e) {
        return NextResponse.json({ ok: false, env, error: String(e) }, { status: 500 });
    }
}
