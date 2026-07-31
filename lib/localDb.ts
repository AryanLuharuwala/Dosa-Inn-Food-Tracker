/**
 * Database layer — local SQLite (better-sqlite3).
 * All data access goes through this module (server-side only).
 */

import { getDb } from './db';
import { menuItems as seedMenuItems, categories as seedCategories } from './menuData';

function nowIso(): string {
    return new Date().toISOString();
}

// ── Analytics ──────────────────────────────────────────────────────────────────

async function appendLog(logType: string, entry: Record<string, unknown>) {
    const db = getDb();
    db.prepare('INSERT INTO analytics_logs (log_type, ts, data) VALUES (?, ?, ?)').run(logType, nowIso(), JSON.stringify(entry));
}

export async function logPayment(entry: Record<string, unknown>) { await appendLog('payment', entry); }
export async function logOrder(entry: Record<string, unknown>) { await appendLog('order', entry); }
export async function logCancellation(entry: Record<string, unknown>) { await appendLog('cancellation', entry); }
export async function logCartAbandonment(entry: Record<string, unknown>) { await appendLog('cart_abandonment', entry); }

// ── Menu items ─────────────────────────────────────────────────────────────────

export async function getMenuItems() {
    const db = getDb();
    const rows = db.prepare('SELECT data FROM menu_items').all() as { data: string }[];
    const docs = rows.map(r => JSON.parse(r.data) as Record<string, unknown>);

    if (docs.length === 0) {
        await seedMenuItemsToDb();
        return getMenuItems();
    }

    // One-time migration: items with inline addOns/extras but no modifierGroupIds
    // yet get migrated to shared modifier groups. Idempotent — runs at most once
    // per item.
    const needsMigration = docs.some(d => !d.modifierGroupIds && ((d.addOns as unknown[])?.length || (d.extras as unknown[])?.length));
    if (needsMigration) {
        await migrateInlineModifiersToGroups();
        return getMenuItems(); // re-fetch with migrated state
    }

    docs.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return ta - tb;
    });

    // Resolve modifierGroupIds → inline addOns/extras so cart/checkout code is unchanged
    const groups = await getModifierGroups();
    const groupMap = new Map(groups.map(g => [g.id, g]));

    return docs.map(d => {
        const groupIds = (d.modifierGroupIds as string[]) ?? [];
        const inlineAddOns = (d.addOns as Modifier[]) ?? [];
        const inlineExtras = (d.extras as Modifier[]) ?? [];

        // Resolve groups + dedupe with any inline (inline takes precedence by id)
        const resolvedAddOns: Modifier[] = [...inlineAddOns];
        const resolvedExtras: Modifier[] = [...inlineExtras];
        const seenIds = new Set([...inlineAddOns, ...inlineExtras].map(m => m.id));
        for (const gid of groupIds) {
            const g = groupMap.get(gid);
            if (!g) continue;
            for (const m of g.modifiers) {
                if (seenIds.has(m.id)) continue;
                seenIds.add(m.id);
                if (g.type === 'addOn') resolvedAddOns.push(m);
                else resolvedExtras.push(m);
            }
        }

        return {
            id: String(d.id),
            name: d.name as string,
            description: d.description as string,
            price: d.price as number,
            categoryId: d.categoryId as string,
            tags: (d.tags as string[]) ?? [],
            isAvailable: d.isAvailable as boolean,
            image: d.image as string | undefined,
            modifierGroupIds: groupIds,
            addOns: resolvedAddOns,
            extras: resolvedExtras,
        };
    });
}

/**
 * One-time migration: walks every item, dedupes inline addOns/extras by structural
 * equality (sorted-by-id JSON of {id,name,price}[]), creates a ModifierGroup for
 * each unique signature, links the item to the group(s), and clears the inline
 * arrays. Group names are derived from the item's category to keep them readable.
 */
async function migrateInlineModifiersToGroups() {
    const db = getDb();
    const rows = db.prepare('SELECT id, data FROM menu_items').all() as { id: string; data: string }[];
    const items: (Record<string, unknown> & { id: string })[] = rows.map(r => ({ id: r.id, ...(JSON.parse(r.data) as Record<string, unknown>) }));
    const cats = await getCategories();
    const catName = new Map(cats.map(c => [c.id, c.name]));

    // signature -> { id, type, name, modifiers }
    const groupBySig = new Map<string, ModifierGroup>();
    const itemUpdates: Array<{ id: string; groupIds: string[] }> = [];

    function sig(arr: Modifier[]): string {
        return JSON.stringify([...arr].sort((a, b) => a.id.localeCompare(b.id)).map(m => ({ id: m.id, name: m.name, price: m.price })));
    }

    function ensureGroup(arr: Modifier[], type: 'addOn' | 'extra', categoryId: string): string | null {
        if (!arr.length) return null;
        const s = type + '|' + sig(arr);
        const existing = groupBySig.get(s);
        if (existing) return existing.id;
        const id = `mg_${type}_${Math.random().toString(36).slice(2, 10)}`;
        const baseName = catName.get(categoryId) ?? 'Items';
        const g: ModifierGroup = {
            id,
            name: `${baseName} — ${type === 'addOn' ? 'Add-ons' : 'Extras'}`,
            type,
            modifiers: arr.map(m => ({ id: m.id, name: m.name, price: m.price })),
        };
        groupBySig.set(s, g);
        return id;
    }

    for (const item of items) {
        // Skip items already migrated
        if (item.modifierGroupIds) continue;
        const inlineAddOns = ((item.addOns as Modifier[]) ?? []).filter(m => m && m.id);
        const inlineExtras = ((item.extras as Modifier[]) ?? []).filter(m => m && m.id);
        if (!inlineAddOns.length && !inlineExtras.length) {
            // Mark as migrated with empty array so we don't re-check
            itemUpdates.push({ id: item.id, groupIds: [] });
            continue;
        }
        const ids: string[] = [];
        const addOnId = ensureGroup(inlineAddOns, 'addOn', item.categoryId as string);
        const extraId = ensureGroup(inlineExtras, 'extra', item.categoryId as string);
        if (addOnId) ids.push(addOnId);
        if (extraId) ids.push(extraId);
        itemUpdates.push({ id: item.id, groupIds: ids });
    }

    // Persist groups
    for (const g of groupBySig.values()) {
        await upsertModifierGroup(g);
    }
    // Update items: set modifierGroupIds, clear inline arrays
    const getRow = db.prepare('SELECT data FROM menu_items WHERE id = ?');
    const update = db.prepare('UPDATE menu_items SET data = ? WHERE id = ?');
    for (const u of itemUpdates) {
        const row = getRow.get(u.id) as { data: string } | undefined;
        if (!row) continue;
        const doc = JSON.parse(row.data);
        doc.modifierGroupIds = u.groupIds;
        doc.addOns = [];
        doc.extras = [];
        doc.migratedAt = nowIso();
        update.run(JSON.stringify(doc), u.id);
    }
}

async function seedMenuItemsToDb() {
    const db = getDb();
    const insert = db.prepare('INSERT OR IGNORE INTO menu_items (id, created_at, data) VALUES (?, ?, ?)');
    const now = nowIso();
    for (const item of seedMenuItems as unknown as Record<string, unknown>[]) {
        insert.run(item.id as string, now, JSON.stringify({ ...item, createdAt: now }));
    }
}

export async function saveMenuItems(items: unknown[]) {
    const db = getDb();
    const get = db.prepare('SELECT data FROM menu_items WHERE id = ?');
    const upsert = db.prepare('INSERT INTO menu_items (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
    for (const _item of items) {
        const item = _item as Record<string, unknown>;
        const id = item.id as string;
        const existing = get.get(id) as { data: string } | undefined;
        const now = nowIso();
        const createdAt = existing ? ((JSON.parse(existing.data).createdAt as string) ?? now) : now;
        const merged = existing
            ? { ...JSON.parse(existing.data), ...item, updatedAt: now }
            : { ...item, createdAt, updatedAt: now };
        upsert.run(id, createdAt, JSON.stringify(merged));
    }
}

export async function updateMenuItemFields(id: string, updates: Record<string, unknown>) {
    const db = getDb();
    const row = db.prepare('SELECT data FROM menu_items WHERE id = ?').get(id) as { data: string } | undefined;
    if (!row) {
        console.log(`[updateMenuItemFields] id=${id} matched=0 modified=0`);
        return;
    }
    const doc = { ...JSON.parse(row.data), ...updates, updatedAt: nowIso() };
    db.prepare('UPDATE menu_items SET data = ? WHERE id = ?').run(JSON.stringify(doc), id);
    console.log(`[updateMenuItemFields] id=${id} matched=1 modified=1`);
}

export async function deleteMenuItemById(id: string) {
    const db = getDb();
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
}

// ── Modifier Groups (shared add-ons & extras) ─────────────────────────────────

export interface Modifier {
    id: string;
    name: string;
    price: number;
}

export interface ModifierGroup {
    id: string;
    name: string;
    type: 'addOn' | 'extra';
    modifiers: Modifier[];
}

export async function getModifierGroups(): Promise<ModifierGroup[]> {
    const db = getDb();
    const rows = db.prepare('SELECT data FROM modifier_groups').all() as { data: string }[];
    return rows.map(r => {
        const d = JSON.parse(r.data);
        return {
            id: d.id as string,
            name: d.name as string,
            type: d.type as 'addOn' | 'extra',
            modifiers: (d.modifiers as Modifier[]) ?? [],
        };
    });
}

export async function upsertModifierGroup(group: ModifierGroup) {
    const db = getDb();
    const existing = db.prepare('SELECT data FROM modifier_groups WHERE id = ?').get(group.id) as { data: string } | undefined;
    const now = nowIso();
    const createdAt = existing ? ((JSON.parse(existing.data).createdAt as string) ?? now) : now;
    const doc = { ...group, createdAt, updatedAt: now };
    db.prepare('INSERT INTO modifier_groups (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
        .run(group.id, createdAt, JSON.stringify(doc));
}

export async function deleteModifierGroupById(id: string) {
    const db = getDb();
    db.prepare('DELETE FROM modifier_groups WHERE id = ?').run(id);
    // Also unlink from any items that referenced it
    const rows = db.prepare('SELECT id, data FROM menu_items').all() as { id: string; data: string }[];
    const update = db.prepare('UPDATE menu_items SET data = ? WHERE id = ?');
    for (const row of rows) {
        const doc = JSON.parse(row.data);
        if (Array.isArray(doc.modifierGroupIds) && doc.modifierGroupIds.includes(id)) {
            doc.modifierGroupIds = doc.modifierGroupIds.filter((g: string) => g !== id);
            update.run(JSON.stringify(doc), row.id);
        }
    }
}

// ── Categories ─────────────────────────────────────────────────────────────────

export async function getCategories() {
    const db = getDb();
    const rows = db.prepare('SELECT data FROM categories').all() as { data: string }[];
    const docs = rows.map(r => JSON.parse(r.data) as Record<string, unknown>);

    if (docs.length === 0) {
        await seedCategoriesToDb();
        return getCategories();
    }

    docs.sort((a, b) => {
        const sa = (a.sortOrder as number) ?? 0;
        const sb = (b.sortOrder as number) ?? 0;
        if (sa !== sb) return sa - sb;
        const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return ta - tb;
    });

    return docs.map(d => ({
        id: String(d.id),
        name: d.name as string,
        tagline: d.tagline as string | undefined,
        icon: d.icon as string,
        sortOrder: d.sortOrder as number,
    }));
}

async function seedCategoriesToDb() {
    const db = getDb();
    const insert = db.prepare('INSERT OR IGNORE INTO categories (id, created_at, data) VALUES (?, ?, ?)');
    const now = nowIso();
    for (const cat of seedCategories as unknown as Record<string, unknown>[]) {
        insert.run(cat.id as string, now, JSON.stringify({ ...cat, createdAt: now }));
    }
}

export async function saveCategories(cats: unknown[]) {
    const db = getDb();
    const get = db.prepare('SELECT data FROM categories WHERE id = ?');
    const upsert = db.prepare('INSERT INTO categories (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
    for (const _cat of cats) {
        const cat = _cat as Record<string, unknown>;
        const id = cat.id as string;
        const existing = get.get(id) as { data: string } | undefined;
        const now = nowIso();
        const createdAt = existing ? ((JSON.parse(existing.data).createdAt as string) ?? now) : now;
        const merged = existing
            ? { ...JSON.parse(existing.data), ...cat, updatedAt: now }
            : { ...cat, createdAt, updatedAt: now };
        upsert.run(id, createdAt, JSON.stringify(merged));
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
    merchantOrderId?: string;
    customerPhone?: string;
    customerName?: string;
    /** 'online' = paid via PhonePe; 'counter' = pay-at-counter mode (no token verification). */
    paymentMethod?: 'online' | 'counter';
    /** Stamped the moment status transitions to 'ready' — used by the
     *  order_ready_uncollected automation rule to measure wait time. */
    readyAt?: string;
}

function docToOrder(d: Record<string, unknown>): Order {
    return {
        orderId: d.orderId as string,
        orderType: d.orderType as Order['orderType'],
        tableNumber: d.tableNumber as string | null,
        preorderDetails: d.preorderDetails as Order['preorderDetails'],
        tokenNumber: d.tokenNumber as number,
        items: d.items as Order['items'],
        extras: d.extras as Order['extras'],
        totalAmount: d.totalAmount as number,
        timestamp: d.timestamp as string,
        status: d.status as Order['status'],
        tokenId: d.tokenId as string | undefined,
        phonePeOrderId: d.phonePeOrderId as string | undefined,
        merchantOrderId: d.merchantOrderId as string | undefined,
        customerPhone: d.customerPhone as string | undefined,
        customerName: d.customerName as string | undefined,
        paymentMethod: d.paymentMethod as 'online' | 'counter' | undefined,
        readyAt: d.readyAt as string | undefined,
    };
}

export async function findOrderByMerchantOrderId(merchantOrderId: string): Promise<Order | null> {
    const db = getDb();
    const row = db.prepare('SELECT data FROM orders WHERE merchant_order_id = ?').get(merchantOrderId) as { data: string } | undefined;
    return row ? docToOrder(JSON.parse(row.data)) : null;
}

export async function getOrders(): Promise<Order[]> {
    const db = getDb();
    const rows = db.prepare('SELECT data FROM orders ORDER BY created_at DESC').all() as { data: string }[];
    return rows.map(r => docToOrder(JSON.parse(r.data)));
}

export async function appendOrder(order: Order) {
    const db = getDb();
    const existing = db.prepare('SELECT 1 FROM orders WHERE order_id = ?').get(order.orderId);
    if (!existing) {
        const now = nowIso();
        db.prepare('INSERT INTO orders (order_id, merchant_order_id, created_at, data) VALUES (?, ?, ?, ?)')
            .run(order.orderId, order.merchantOrderId ?? null, now, JSON.stringify({ ...order, createdAt: now }));
    }
    await logOrder({ event: 'order_placed', orderId: order.orderId, amount: order.totalAmount, items: order.items.length });
}

export async function deleteOrderById(orderId: string): Promise<boolean> {
    const db = getDb();
    const res = db.prepare('DELETE FROM orders WHERE order_id = ?').run(orderId);
    return res.changes > 0;
}

export async function updateOrderStatus(
    orderId: string,
    status: Order['status'],
    itemsPayload?: Order['items']
): Promise<boolean> {
    const db = getDb();
    const row = db.prepare('SELECT data FROM orders WHERE order_id = ?').get(orderId) as { data: string } | undefined;
    if (!row) return false;
    const doc = JSON.parse(row.data);
    if (status === 'ready' && doc.status !== 'ready') doc.readyAt = nowIso();
    doc.status = status;
    if (itemsPayload) doc.items = itemsPayload;
    db.prepare('UPDATE orders SET data = ? WHERE order_id = ?').run(JSON.stringify(doc), orderId);
    return true;
}

// ── Settings ───────────────────────────────────────────────────────────────────

export interface Settings {
    rushHourMode: boolean;
    rushHourItems: string[];
    restaurantName?: string;
    tagline?: string;
    /** Legal/registered business name — required by payment gateways for compliance. */
    legalName?: string;
    /** Master switch. When false, customers skip the gateway and pay at the counter. */
    paymentsEnabled?: boolean;
    /** Copies the printer should produce per "Print KOT" click (default 1). */
    kotCopies?: number;
    /** Copies the printer should produce per "Print Bill" click (default 1). */
    billCopies?: number;
    /** When true and a printer is connected, every newly-arrived order auto-prints a KOT. */
    autoPrintOrders?: boolean;
    /** Visual bill template configuration set via the bill editor. */
    billTemplate?: import('./billTemplate').BillTemplate;
    /** Gates the WhatsApp inbound auto-reply/ordering flow. 'off' (default)
     *  never responds to anyone; 'test_only' only responds to numbers in
     *  DEBUG_TEST_PHONES; 'live' responds to any real inbound message. */
    whatsappAutoReplyMode?: 'off' | 'test_only' | 'live';
}

export async function getSettings(): Promise<Settings> {
    const db = getDb();
    const row = db.prepare('SELECT data FROM settings WHERE id = ?').get('global') as { data: string } | undefined;
    const doc = row ? JSON.parse(row.data) as Record<string, unknown> : {};
    return {
        rushHourMode: (doc.rushHourMode as boolean) ?? false,
        rushHourItems: (doc.rushHourItems as string[]) ?? [],
        restaurantName: (doc.restaurantName as string) ?? 'Rocky Da Adda',
        tagline: (doc.tagline as string) ?? '100% Pure Veg',
        legalName: (doc.legalName as string) ?? '',
        paymentsEnabled: (doc.paymentsEnabled as boolean) ?? false,
        kotCopies: clampCopies(doc.kotCopies as number | undefined, 1),
        billCopies: clampCopies(doc.billCopies as number | undefined, 1),
        autoPrintOrders: (doc.autoPrintOrders as boolean) ?? false,
        billTemplate: (doc.billTemplate as import('./billTemplate').BillTemplate) ?? undefined,
        whatsappAutoReplyMode: (doc.whatsappAutoReplyMode as Settings['whatsappAutoReplyMode']) ?? 'off',
    };
}

function clampCopies(n: number | undefined, fallback: number): number {
    if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(10, Math.round(n)));
}

export async function saveSettings(s: Settings) {
    const db = getDb();
    // Callers routinely send partial updates (e.g. just { autoPrintOrders })
    // expecting other fields to survive — merge onto the existing row rather
    // than replacing it outright.
    const existing = db.prepare('SELECT data FROM settings WHERE id = ?').get('global') as { data: string } | undefined;
    const doc = { ...(existing ? JSON.parse(existing.data) : {}), ...s, updatedAt: nowIso() };
    db.prepare('INSERT INTO settings (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
        .run('global', JSON.stringify(doc));
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
    const db = getDb();
    const rows = db.prepare('SELECT data FROM chefs').all() as { data: string }[];
    const docs = rows.map(r => JSON.parse(r.data) as Record<string, unknown>);
    docs.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return ta - tb;
    });
    return docs.map(d => ({
        id: d.id as string,
        name: d.name as string,
        is_active: d.is_active as boolean,
        color: d.color as string,
    }));
}

export async function saveChefs(chefs: Chef[]) {
    const db = getDb();
    const get = db.prepare('SELECT data FROM chefs WHERE id = ?');
    const upsert = db.prepare('INSERT INTO chefs (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data');
    for (const chef of chefs) {
        const existing = get.get(chef.id) as { data: string } | undefined;
        const now = nowIso();
        const createdAt = existing ? ((JSON.parse(existing.data).createdAt as string) ?? now) : now;
        const merged = existing
            ? { ...JSON.parse(existing.data), ...chef, updatedAt: now }
            : { ...chef, createdAt, updatedAt: now };
        upsert.run(chef.id, createdAt, JSON.stringify(merged));
    }
}

export async function getChefCategories(): Promise<ChefCategory[]> {
    const db = getDb();
    const rows = db.prepare('SELECT chef_id, category_id FROM chef_categories').all() as ChefCategory[];
    return rows.map(r => ({ chef_id: r.chef_id, category_id: r.category_id }));
}

export async function saveChefCategories(cc: ChefCategory[]) {
    const db = getDb();
    const tx = db.transaction((rows: ChefCategory[]) => {
        db.prepare('DELETE FROM chef_categories').run();
        const insert = db.prepare('INSERT INTO chef_categories (chef_id, category_id) VALUES (?, ?)');
        for (const r of rows) insert.run(r.chef_id, r.category_id);
    });
    tx(cc);
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

function docToCart(d: Record<string, unknown>): SharedCart {
    return {
        code: d.code as string,
        tableNumber: d.tableNumber as string,
        tokenNumber: d.tokenNumber as number,
        createdAt: d.createdAt as string,
        expiresAt: d.expiresAt as string,
        participants: d.participants as SharedCartParticipant[],
    };
}

export async function createSharedCart(tableNumber: string, tokenNumber: number, visitorId: string): Promise<SharedCart> {
    const db = getDb();
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const participants: SharedCartParticipant[] = [{ visitorId, joinedAt: now.toISOString(), items: [], extras: [] }];
    const doc: SharedCart = {
        code, tableNumber, tokenNumber, participants,
        createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
    };
    db.prepare('INSERT INTO shared_carts (code, expires_at, data) VALUES (?, ?, ?)').run(code, doc.expiresAt, JSON.stringify(doc));
    return doc;
}

export async function getSharedCart(code: string): Promise<SharedCart | null> {
    const db = getDb();
    const row = db.prepare('SELECT data FROM shared_carts WHERE code = ? AND expires_at > ?').get(code, new Date().toISOString()) as { data: string } | undefined;
    return row ? docToCart(JSON.parse(row.data)) : null;
}

export async function joinSharedCart(
    code: string,
    visitorId: string,
    mergeParticipants?: SharedCartParticipant[]
): Promise<SharedCart | null> {
    const db = getDb();
    const row = db.prepare('SELECT data FROM shared_carts WHERE code = ? AND expires_at > ?').get(code, new Date().toISOString()) as { data: string } | undefined;
    if (!row) return null;

    const cart = docToCart(JSON.parse(row.data));
    const existing = new Set(cart.participants.map(p => p.visitorId));
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

    cart.participants = [...cart.participants, ...toAdd];
    db.prepare('UPDATE shared_carts SET data = ? WHERE code = ?').run(JSON.stringify(cart), code);
    return cart;
}

export async function updateSharedCartParticipant(
    code: string,
    visitorId: string,
    items: SharedCartItem[],
    extras: SharedCartExtra[]
): Promise<SharedCart | null> {
    const db = getDb();
    const row = db.prepare('SELECT data FROM shared_carts WHERE code = ? AND expires_at > ?').get(code, new Date().toISOString()) as { data: string } | undefined;
    if (!row) return null;

    const cart = docToCart(JSON.parse(row.data));
    const idx = cart.participants.findIndex(p => p.visitorId === visitorId);
    if (idx === -1) return null;

    cart.participants[idx].items = items;
    cart.participants[idx].extras = extras;
    db.prepare('UPDATE shared_carts SET data = ? WHERE code = ?').run(JSON.stringify(cart), code);
    return cart;
}
