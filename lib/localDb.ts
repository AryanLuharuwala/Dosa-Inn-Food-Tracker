/**
 * Database layer — Azure PostgreSQL.
 * All data access goes through this module (server-side only).
 * Clients talk to /api/db routes.
 */

import { query, queryOne } from './db';
import { menuItems as seedMenuItems, categories as seedCategories } from './menuData';

// ── Analytics logs ────────────────────────────────────────────────────────────

async function appendLog(logType: string, entry: Record<string, unknown>) {
    await query(
        `INSERT INTO analytics_logs (log_type, entry) VALUES ($1, $2)`,
        [logType, { ...entry, ts: new Date().toISOString() }]
    );
}

export async function logPayment(entry: Record<string, unknown>) { await appendLog('payment', entry); }
export async function logOrder(entry: Record<string, unknown>) { await appendLog('order', entry); }
export async function logCancellation(entry: Record<string, unknown>) { await appendLog('cancellation', entry); }
export async function logCartAbandonment(entry: Record<string, unknown>) { await appendLog('cart_abandonment', entry); }

// ── Menu items ─────────────────────────────────────────────────────────────────

export async function getMenuItems() {
    const rows = await query<{
        id: string; name: string; description: string; price: number;
        category_id: string; tags: string[]; is_available: boolean;
        image: string | null; add_ons: unknown[]; extras: unknown[];
    }>(`SELECT * FROM menu_items ORDER BY created_at`);

    if (rows.length === 0) {
        // First run — seed from menuData
        await seedMenuItemsToDb();
        return getMenuItems();
    }

    return rows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        price: r.price, categoryId: r.category_id, tags: r.tags ?? [],
        isAvailable: r.is_available, image: r.image ?? undefined,
        addOns: r.add_ons ?? [], extras: r.extras ?? [],
    }));
}

async function seedMenuItemsToDb() {
    for (const _item of seedMenuItems) {
        const item = _item as unknown as Record<string, unknown>;
        await query(
            `INSERT INTO menu_items (id, name, description, price, category_id, tags, is_available, image, add_ons, extras)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (id) DO NOTHING`,
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
}

export async function saveMenuItems(items: unknown[]) {
    for (const _item of items) {
        const item = _item as Record<string, unknown>;
        await query(
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
}

// ── Categories ─────────────────────────────────────────────────────────────────

export async function getCategories() {
    const rows = await query<{
        id: string; name: string; tagline: string | null; icon: string; sort_order: number;
    }>(`SELECT * FROM categories ORDER BY sort_order, created_at`);

    if (rows.length === 0) {
        await seedCategoriesToDb();
        return getCategories();
    }

    return rows.map(r => ({
        id: r.id, name: r.name, tagline: r.tagline ?? undefined,
        icon: r.icon, sortOrder: r.sort_order,
    }));
}

async function seedCategoriesToDb() {
    for (const _cat of seedCategories) {
        const cat = _cat as unknown as Record<string, unknown>;
        await query(
            `INSERT INTO categories (id, name, tagline, icon, sort_order)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO NOTHING`,
            [cat.id, cat.name, cat.tagline ?? null, cat.icon ?? '🍽️', cat.sortOrder ?? 0]
        );
    }
}

export async function saveCategories(cats: unknown[]) {
    for (const _cat of cats) {
        const cat = _cat as Record<string, unknown>;
        await query(
            `INSERT INTO categories (id, name, tagline, icon, sort_order)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (id) DO UPDATE SET name=$2, tagline=$3, icon=$4, sort_order=$5`,
            [cat.id, cat.name, cat.tagline ?? null, cat.icon ?? '🍽️', cat.sortOrder ?? 0]
        );
    }
}

// ── Orders ─────────────────────────────────────────────────────────────────────

export interface Order {
    orderId: string;
    orderType: 'dine-in' | 'preorder';
    tableNumber: string | null;
    preorderDetails: { pickupTime: string; customerName: string; customerPhone: string } | null;
    tokenNumber: number;
    items: Array<{
        menuItem: { id: string; name: string; price: number };
        quantity: number;
        selectedAddOns: Array<{ id: string; name: string; price: number }>;
        totalPrice: number;
    }>;
    extras: Array<{ extra: { id: string; name: string; price: number }; quantity: number }>;
    totalAmount: number;
    timestamp: string;
    status: 'pending' | 'preparing' | 'ready' | 'delivered';
    tokenId?: string;
    phonePeOrderId?: string;
    customerPhone?: string;
    customerName?: string;
}

function rowToOrder(r: Record<string, unknown>): Order {
    return {
        orderId: r.order_id as string,
        orderType: r.order_type as Order['orderType'],
        tableNumber: r.table_number as string | null,
        preorderDetails: r.preorder_details as Order['preorderDetails'],
        tokenNumber: r.token_number as number,
        items: r.items as Order['items'],
        extras: r.extras as Order['extras'],
        totalAmount: r.total_amount as number,
        timestamp: (r.timestamp as Date).toISOString(),
        status: r.status as Order['status'],
        tokenId: r.token_id as string | undefined,
        phonePeOrderId: r.phone_pe_order_id as string | undefined,
        customerPhone: r.customer_phone as string | undefined,
        customerName: r.customer_name as string | undefined,
    };
}

export async function getOrders(): Promise<Order[]> {
    const rows = await query<Record<string, unknown>>(
        `SELECT * FROM orders ORDER BY created_at DESC`
    );
    return rows.map(rowToOrder);
}

export async function appendOrder(order: Order) {
    await query(
        `INSERT INTO orders
            (order_id, order_type, table_number, token_number, preorder_details,
             items, extras, total_amount, status, token_id, phone_pe_order_id,
             customer_phone, customer_name, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (order_id) DO NOTHING`,
        [
            order.orderId, order.orderType, order.tableNumber ?? null,
            order.tokenNumber, order.preorderDetails ? JSON.stringify(order.preorderDetails) : null,
            JSON.stringify(order.items), JSON.stringify(order.extras),
            order.totalAmount, order.status,
            order.tokenId ?? null, order.phonePeOrderId ?? null,
            order.customerPhone ?? null, order.customerName ?? null,
            order.timestamp,
        ]
    );
    await logOrder({ event: 'order_placed', orderId: order.orderId, amount: order.totalAmount, items: order.items.length });
}

export async function updateOrderStatus(
    orderId: string,
    status: Order['status'],
    itemsPayload?: Order['items']
): Promise<boolean> {
    const result = await pool_update_order(orderId, status, itemsPayload);
    return result;
}

async function pool_update_order(orderId: string, status: Order['status'], itemsPayload?: Order['items']) {
    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
        if (itemsPayload) {
            const res = await client.query(
                `UPDATE orders SET status=$1, items=$2 WHERE order_id=$3`,
                [status, JSON.stringify(itemsPayload), orderId]
            );
            return (res.rowCount ?? 0) > 0;
        } else {
            const res = await client.query(
                `UPDATE orders SET status=$1 WHERE order_id=$2`,
                [status, orderId]
            );
            return (res.rowCount ?? 0) > 0;
        }
    } finally {
        client.release();
    }
}

// ── Settings ───────────────────────────────────────────────────────────────────

export interface Settings {
    rushHourMode: boolean;
    rushHourItems: string[];
    restaurantName?: string;
    tagline?: string;
}

export async function getSettings(): Promise<Settings> {
    const rows = await query<{ key: string; value: unknown }>(
        `SELECT key, value FROM settings WHERE key IN ('rushHourMode','rushHourItems','restaurantName','tagline')`
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
        rushHourMode: (map.rushHourMode as boolean) ?? false,
        rushHourItems: (map.rushHourItems as string[]) ?? [],
        restaurantName: (map.restaurantName as string) ?? 'Rocky Da Adda',
        tagline: (map.tagline as string) ?? '100% Pure Veg',
    };
}

export async function saveSettings(s: Settings) {
    const entries: [string, unknown][] = [
        ['rushHourMode', s.rushHourMode],
        ['rushHourItems', s.rushHourItems],
        ['restaurantName', s.restaurantName ?? 'Rocky Da Adda'],
        ['tagline', s.tagline ?? '100% Pure Veg'],
    ];
    for (const [key, value] of entries) {
        await query(
            `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value=$2::jsonb, updated_at=NOW()`,
            [key, JSON.stringify(value)]
        );
    }
}

// ── Chefs ──────────────────────────────────────────────────────────────────────

export interface Chef {
    id: string;
    name: string;
    is_active: boolean;
    color: string;
}

export interface ChefCategory {
    chef_id: string;
    category_id: string;
}

export async function getChefs(): Promise<Chef[]> {
    return query<Chef>(`SELECT id, name, is_active, color FROM chefs ORDER BY created_at`);
}

export async function saveChefs(chefs: Chef[]) {
    for (const chef of chefs) {
        await query(
            `INSERT INTO chefs (id, name, is_active, color)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (id) DO UPDATE SET name=$2, is_active=$3, color=$4`,
            [chef.id, chef.name, chef.is_active, chef.color]
        );
    }
}

export async function getChefCategories(): Promise<ChefCategory[]> {
    return query<ChefCategory>(`SELECT chef_id, category_id FROM chef_categories`);
}

export async function saveChefCategories(cc: ChefCategory[]) {
    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM chef_categories`);
        for (const row of cc) {
            await client.query(
                `INSERT INTO chef_categories (chef_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                [row.chef_id, row.category_id]
            );
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

// ── Shared carts ───────────────────────────────────────────────────────────────

export interface SharedCartItem {
    id: string;
    menuItem: { id: string; name: string; price: number; image?: string };
    quantity: number;
    selectedAddOns: Array<{ id: string; name: string; price: number }>;
    totalPrice: number;
}

export interface SharedCartExtra {
    id: string;
    extra: { id: string; name: string; price: number };
    quantity: number;
}

export interface SharedCartParticipant {
    visitorId: string;
    joinedAt: string;
    items: SharedCartItem[];
    extras: SharedCartExtra[];
}

export interface SharedCart {
    code: string;
    tableNumber: string;
    tokenNumber: number;
    createdAt: string;
    expiresAt: string;
    participants: SharedCartParticipant[];
}

function rowToCart(r: Record<string, unknown>): SharedCart {
    return {
        code: r.code as string,
        tableNumber: r.table_number as string,
        tokenNumber: r.token_number as number,
        createdAt: (r.created_at as Date).toISOString(),
        expiresAt: (r.expires_at as Date).toISOString(),
        participants: r.participants as SharedCartParticipant[],
    };
}

export async function createSharedCart(tableNumber: string, tokenNumber: number, visitorId: string): Promise<SharedCart> {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const participants: SharedCartParticipant[] = [{ visitorId, joinedAt: now.toISOString(), items: [], extras: [] }];
    const row = await queryOne<Record<string, unknown>>(
        `INSERT INTO shared_carts (code, table_number, token_number, participants, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [code, tableNumber, tokenNumber, JSON.stringify(participants), expiresAt]
    );
    return rowToCart(row!);
}

export async function getSharedCart(code: string): Promise<SharedCart | null> {
    const row = await queryOne<Record<string, unknown>>(
        `SELECT * FROM shared_carts WHERE code=$1 AND expires_at > NOW()`,
        [code]
    );
    return row ? rowToCart(row) : null;
}

export async function joinSharedCart(
    code: string,
    visitorId: string,
    mergeParticipants?: SharedCartParticipant[]
): Promise<SharedCart | null> {
    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT * FROM shared_carts WHERE code=$1 AND expires_at > NOW() FOR UPDATE`,
            [code]
        );
        if (!rows.length) { await client.query('ROLLBACK'); return null; }
        const cart = rowToCart(rows[0]);

        const existing = new Set(cart.participants.map((p: SharedCartParticipant) => p.visitorId));
        const toAdd: SharedCartParticipant[] = [];

        if (!existing.has(visitorId)) {
            if (mergeParticipants?.length) {
                for (const mp of mergeParticipants) {
                    if (!existing.has(mp.visitorId)) { toAdd.push(mp); existing.add(mp.visitorId); }
                }
            } else {
                toAdd.push({ visitorId, joinedAt: new Date().toISOString(), items: [], extras: [] });
            }
        } else if (mergeParticipants?.length) {
            for (const mp of mergeParticipants) {
                if (!existing.has(mp.visitorId)) { toAdd.push(mp); existing.add(mp.visitorId); }
            }
        }

        const updated = [...cart.participants, ...toAdd];
        await client.query(
            `UPDATE shared_carts SET participants=$1 WHERE code=$2`,
            [JSON.stringify(updated), code]
        );
        await client.query('COMMIT');
        cart.participants = updated;
        return cart;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

export async function updateSharedCartParticipant(
    code: string,
    visitorId: string,
    items: SharedCartItem[],
    extras: SharedCartExtra[]
): Promise<SharedCart | null> {
    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT * FROM shared_carts WHERE code=$1 AND expires_at > NOW() FOR UPDATE`,
            [code]
        );
        if (!rows.length) { await client.query('ROLLBACK'); return null; }
        const cart = rowToCart(rows[0]);
        const idx = cart.participants.findIndex((p: SharedCartParticipant) => p.visitorId === visitorId);
        if (idx === -1) { await client.query('ROLLBACK'); return null; }
        cart.participants[idx].items = items;
        cart.participants[idx].extras = extras;
        await client.query(
            `UPDATE shared_carts SET participants=$1 WHERE code=$2`,
            [JSON.stringify(cart.participants), code]
        );
        await client.query('COMMIT');
        return cart;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}
