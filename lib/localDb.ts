/**
 * Database layer — Azure Cosmos DB for MongoDB.
 * All data access goes through this module (server-side only).
 */

import { getDb } from './db';
import { menuItems as seedMenuItems, categories as seedCategories } from './menuData';

// ── Analytics ──────────────────────────────────────────────────────────────────

async function appendLog(logType: string, entry: Record<string, unknown>) {
    const db = await getDb();
    await db.collection('analytics_logs').insertOne({ logType, ...entry, ts: new Date() });
}

export async function logPayment(entry: Record<string, unknown>) { await appendLog('payment', entry); }
export async function logOrder(entry: Record<string, unknown>) { await appendLog('order', entry); }
export async function logCancellation(entry: Record<string, unknown>) { await appendLog('cancellation', entry); }
export async function logCartAbandonment(entry: Record<string, unknown>) { await appendLog('cart_abandonment', entry); }

// ── Menu items ─────────────────────────────────────────────────────────────────

export async function getMenuItems() {
    const db = await getDb();
    const docs = await db.collection('menu_items').find({}).toArray();

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
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
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
            id: String(d._id ?? d.id),
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
    const db = await getDb();
    const items = await db.collection('menu_items').find({}).toArray();
    const cats = await getCategories();
    const catName = new Map(cats.map(c => [c.id, c.name]));

    // signature -> { id, type, name, modifiers }
    const groupBySig = new Map<string, ModifierGroup>();
    const itemUpdates: Array<{ _id: unknown; groupIds: string[] }> = [];

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
            itemUpdates.push({ _id: item._id, groupIds: [] });
            continue;
        }
        const ids: string[] = [];
        const addOnId = ensureGroup(inlineAddOns, 'addOn', item.categoryId as string);
        const extraId = ensureGroup(inlineExtras, 'extra', item.categoryId as string);
        if (addOnId) ids.push(addOnId);
        if (extraId) ids.push(extraId);
        itemUpdates.push({ _id: item._id, groupIds: ids });
    }

    // Persist groups
    for (const g of groupBySig.values()) {
        await upsertModifierGroup(g);
    }
    // Update items: set modifierGroupIds, clear inline arrays
    for (const u of itemUpdates) {
        await db.collection('menu_items').updateOne(
            { _id: u._id as import('mongodb').ObjectId },
            { $set: { modifierGroupIds: u.groupIds, addOns: [], extras: [], migratedAt: new Date() } }
        );
    }
}

async function seedMenuItemsToDb() {
    const db = await getDb();
    const col = db.collection('menu_items');
    for (const item of seedMenuItems as unknown as Record<string, unknown>[]) {
        await col.updateOne(
            { _id: item.id as import('mongodb').ObjectId },
            { $setOnInsert: { _id: item.id, ...item, createdAt: new Date() } },
            { upsert: true }
        );
    }
}

export async function saveMenuItems(items: unknown[]) {
    const db = await getDb();
    const col = db.collection('menu_items');
    for (const _item of items) {
        const item = _item as Record<string, unknown>;
        await col.updateOne(
            { _id: item.id as import('mongodb').ObjectId },
            { $set: { ...item, updatedAt: new Date() }, $setOnInsert: { _id: item.id, createdAt: new Date() } },
            { upsert: true }
        );
    }
}

export async function updateMenuItemFields(id: string, updates: Record<string, unknown>) {
    const db = await getDb();
    const res = await db.collection('menu_items').updateOne(
        { $or: [{ _id: id as unknown as import('mongodb').ObjectId }, { id }] },
        { $set: { ...updates, updatedAt: new Date() } }
    );
    console.log(`[updateMenuItemFields] id=${id} matched=${res.matchedCount} modified=${res.modifiedCount}`);
}

export async function deleteMenuItemById(id: string) {
    const db = await getDb();
    await db.collection('menu_items').deleteOne({
        $or: [{ _id: id as unknown as import('mongodb').ObjectId }, { id }],
    });
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
    const db = await getDb();
    const docs = await db.collection('modifier_groups').find({}).toArray();
    return docs.map(d => ({
        id: String(d._id ?? d.id),
        name: d.name as string,
        type: d.type as 'addOn' | 'extra',
        modifiers: (d.modifiers as Modifier[]) ?? [],
    }));
}

export async function upsertModifierGroup(group: ModifierGroup) {
    const db = await getDb();
    await db.collection('modifier_groups').updateOne(
        { _id: group.id as unknown as import('mongodb').ObjectId },
        {
            $set: { name: group.name, type: group.type, modifiers: group.modifiers, updatedAt: new Date() },
            $setOnInsert: { _id: group.id, createdAt: new Date() },
        },
        { upsert: true }
    );
}

export async function deleteModifierGroupById(id: string) {
    const db = await getDb();
    await db.collection('modifier_groups').deleteOne({
        $or: [{ _id: id as unknown as import('mongodb').ObjectId }, { id }],
    });
    // Also unlink from any items that referenced it
    await db.collection('menu_items').updateMany(
        { modifierGroupIds: id },
        { $pull: { modifierGroupIds: id as unknown as never } }
    );
}

// ── Categories ─────────────────────────────────────────────────────────────────

export async function getCategories() {
    const db = await getDb();
    const docs = await db.collection('categories').find({}).toArray();

    if (docs.length === 0) {
        await seedCategoriesToDb();
        return getCategories();
    }

    docs.sort((a, b) => {
        const sa = (a.sortOrder as number) ?? 0;
        const sb = (b.sortOrder as number) ?? 0;
        if (sa !== sb) return sa - sb;
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
    });

    return docs.map(d => ({
        id: String(d._id ?? d.id),
        name: d.name as string,
        tagline: d.tagline as string | undefined,
        icon: d.icon as string,
        sortOrder: d.sortOrder as number,
    }));
}

async function seedCategoriesToDb() {
    const db = await getDb();
    const col = db.collection('categories');
    for (const cat of seedCategories as unknown as Record<string, unknown>[]) {
        await col.updateOne(
            { _id: cat.id as import('mongodb').ObjectId },
            { $setOnInsert: { _id: cat.id, ...cat, createdAt: new Date() } },
            { upsert: true }
        );
    }
}

export async function saveCategories(cats: unknown[]) {
    const db = await getDb();
    const col = db.collection('categories');
    for (const _cat of cats) {
        const cat = _cat as Record<string, unknown>;
        await col.updateOne(
            { _id: cat.id as import('mongodb').ObjectId },
            { $set: { ...cat, updatedAt: new Date() }, $setOnInsert: { _id: cat.id, createdAt: new Date() } },
            { upsert: true }
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
    merchantOrderId?: string;
    customerPhone?: string;
    customerName?: string;
    /** 'online' = paid via PhonePe; 'counter' = pay-at-counter mode (no token verification). */
    paymentMethod?: 'online' | 'counter';
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
    };
}

export async function findOrderByMerchantOrderId(merchantOrderId: string): Promise<Order | null> {
    const db = await getDb();
    const doc = await db.collection('orders').findOne({ merchantOrderId });
    return doc ? docToOrder(doc as unknown as Record<string, unknown>) : null;
}

export async function getOrders(): Promise<Order[]> {
    const db = await getDb();
    const docs = await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray();
    return docs.map(d => docToOrder(d as unknown as Record<string, unknown>));
}

export async function appendOrder(order: Order) {
    const db = await getDb();
    await db.collection('orders').updateOne(
        { orderId: order.orderId },
        { $setOnInsert: { ...order, createdAt: new Date() } },
        { upsert: true }
    );
    await logOrder({ event: 'order_placed', orderId: order.orderId, amount: order.totalAmount, items: order.items.length });
}

export async function updateOrderStatus(
    orderId: string,
    status: Order['status'],
    itemsPayload?: Order['items']
): Promise<boolean> {
    const db = await getDb();
    const update: Record<string, unknown> = { status };
    if (itemsPayload) update.items = itemsPayload;
    const res = await db.collection('orders').updateOne({ orderId }, { $set: update });
    return res.matchedCount > 0;
}

// ── Settings ───────────────────────────────────────────────────────────────────

export interface Settings {
    rushHourMode: boolean;
    rushHourItems: string[];
    restaurantName?: string;
    tagline?: string;
    /** Master switch. When false, customers don't see PhonePe and pay at the
     *  counter — orders go straight to confirmation with paymentMethod='counter'. */
    paymentsEnabled?: boolean;
    /** Copies the printer should produce per "Print KOT" click (default 1). */
    kotCopies?: number;
    /** Copies the printer should produce per "Print Bill" click (default 1). */
    billCopies?: number;
    /** When true and a printer is connected, every newly-arrived order auto-prints a KOT. */
    autoPrintOrders?: boolean;
}

export async function getSettings(): Promise<Settings> {
    const db = await getDb();
    const doc = await db.collection('settings').findOne({ _id: 'global' as unknown as import('mongodb').ObjectId });
    return {
        rushHourMode: (doc?.rushHourMode as boolean) ?? false,
        rushHourItems: (doc?.rushHourItems as string[]) ?? [],
        restaurantName: (doc?.restaurantName as string) ?? 'Rocky Da Adda',
        tagline: (doc?.tagline as string) ?? '100% Pure Veg',
        // Default OFF until PhonePe registration is complete — counter payment only.
        paymentsEnabled: (doc?.paymentsEnabled as boolean) ?? false,
        kotCopies: clampCopies(doc?.kotCopies as number | undefined, 1),
        billCopies: clampCopies(doc?.billCopies as number | undefined, 1),
        autoPrintOrders: (doc?.autoPrintOrders as boolean) ?? false,
    };
}

function clampCopies(n: number | undefined, fallback: number): number {
    if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(10, Math.round(n)));
}

export async function saveSettings(s: Settings) {
    const db = await getDb();
    await db.collection('settings').updateOne(
        { _id: 'global' as unknown as import('mongodb').ObjectId },
        { $set: { ...s, updatedAt: new Date() } },
        { upsert: true }
    );
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
    const db = await getDb();
    const docs = await db.collection('chefs').find({}).toArray();
    docs.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
    });
    return docs.map(d => ({ id: d.id, name: d.name, is_active: d.is_active, color: d.color })) as Chef[];
}

export async function saveChefs(chefs: Chef[]) {
    const db = await getDb();
    const col = db.collection('chefs');
    for (const chef of chefs) {
        await col.updateOne(
            { id: chef.id },
            { $set: { ...chef, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
        );
    }
}

export async function getChefCategories(): Promise<ChefCategory[]> {
    const db = await getDb();
    const docs = await db.collection('chef_categories').find({}).toArray();
    return docs.map(d => ({ chef_id: d.chef_id, category_id: d.category_id })) as ChefCategory[];
}

export async function saveChefCategories(cc: ChefCategory[]) {
    const db = await getDb();
    const col = db.collection('chef_categories');
    await col.deleteMany({});
    if (cc.length > 0) await col.insertMany(cc);
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
        createdAt: (d.createdAt as Date).toISOString(),
        expiresAt: (d.expiresAt as Date).toISOString(),
        participants: d.participants as SharedCartParticipant[],
    };
}

export async function createSharedCart(tableNumber: string, tokenNumber: number, visitorId: string): Promise<SharedCart> {
    const db = await getDb();
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const participants: SharedCartParticipant[] = [{ visitorId, joinedAt: now.toISOString(), items: [], extras: [] }];
    const doc = { code, tableNumber, tokenNumber, participants, createdAt: now, expiresAt };
    await db.collection('shared_carts').insertOne(doc);
    return docToCart(doc as unknown as Record<string, unknown>);
}

export async function getSharedCart(code: string): Promise<SharedCart | null> {
    const db = await getDb();
    const doc = await db.collection('shared_carts').findOne({ code, expiresAt: { $gt: new Date() } });
    return doc ? docToCart(doc as unknown as Record<string, unknown>) : null;
}

export async function joinSharedCart(
    code: string,
    visitorId: string,
    mergeParticipants?: SharedCartParticipant[]
): Promise<SharedCart | null> {
    const db = await getDb();
    const doc = await db.collection('shared_carts').findOne({ code, expiresAt: { $gt: new Date() } });
    if (!doc) return null;

    const cart = docToCart(doc as unknown as Record<string, unknown>);
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

    const updated = [...cart.participants, ...toAdd];
    await db.collection('shared_carts').updateOne({ code }, { $set: { participants: updated } });
    cart.participants = updated;
    return cart;
}

export async function updateSharedCartParticipant(
    code: string,
    visitorId: string,
    items: SharedCartItem[],
    extras: SharedCartExtra[]
): Promise<SharedCart | null> {
    const db = await getDb();
    const doc = await db.collection('shared_carts').findOne({ code, expiresAt: { $gt: new Date() } });
    if (!doc) return null;

    const cart = docToCart(doc as unknown as Record<string, unknown>);
    const idx = cart.participants.findIndex(p => p.visitorId === visitorId);
    if (idx === -1) return null;

    cart.participants[idx].items = items;
    cart.participants[idx].extras = extras;
    await db.collection('shared_carts').updateOne({ code }, { $set: { participants: cart.participants } });
    return cart;
}
