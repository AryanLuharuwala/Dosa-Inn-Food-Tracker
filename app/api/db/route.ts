import { NextRequest, NextResponse } from 'next/server';
import {
    getMenuItems, saveMenuItems, updateMenuItemFields, deleteMenuItemById,
    getCategories, saveCategories,
    getModifierGroups, upsertModifierGroup, deleteModifierGroupById,
    getOrders, appendOrder, updateOrderStatus as dbUpdateOrderStatus,
    findOrderByMerchantOrderId,
    getSettings, saveSettings,
    getChefs, saveChefs,
    getChefCategories, saveChefCategories,
    logCancellation, logCartAbandonment, logPayment,
} from '@/lib/localDb';
import type { Order, Chef, ChefCategory, ModifierGroup } from '@/lib/localDb';
import type { MenuItem } from '@/lib/menuData';
import { emit } from '@/lib/serverEvents';
import { sendWhatsApp, formatOrderMessage } from '@/lib/whatsapp';
import { isAdminRequest, getVisitorId } from '@/lib/apiAuth';
import { consumePaymentToken } from '@/lib/paymentTokens';

const ADMIN_ONLY = new Set([
    'menu_update_item', 'menu_add_item', 'menu_delete_item',
    'category_add', 'category_update', 'category_delete',
    'modifier_group_upsert', 'modifier_group_delete',
    'order_status',
    'settings_save',
    'chef_upsert', 'chef_delete', 'chef_categories_set',
]);

const PUBLIC_POST = new Set([
    'order_add',
    'log_cancellation', 'log_cart_abandonment', 'log_payment',
]);

function deny() {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// GET /api/db?resource=...
export async function GET(req: NextRequest) {
    const resource = req.nextUrl.searchParams.get('resource');
    const tokenId = req.nextUrl.searchParams.get('tokenId');
    const orderId = req.nextUrl.searchParams.get('orderId');
    const isAdmin = isAdminRequest(req);

    try {
        switch (resource) {
            case 'menu_items':
                return NextResponse.json(await getMenuItems());

            case 'categories':
                return NextResponse.json(await getCategories());

            case 'modifier_groups':
                return NextResponse.json(await getModifierGroups());

            case 'orders': {
                const orders = await getOrders();
                if (isAdmin) return NextResponse.json(orders);
                if (!tokenId) return NextResponse.json({ error: 'tokenId required' }, { status: 400 });
                const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
                const filtered = orders.filter(o =>
                    o.tokenId === tokenId && new Date(o.timestamp).getTime() > twoHoursAgo
                );
                if (orderId) return NextResponse.json(filtered.filter(o => o.orderId === orderId));
                return NextResponse.json(filtered);
            }

            case 'active_tokens': {
                const orders = await getOrders();
                return NextResponse.json(orders.filter(o => o.status !== 'delivered').map(o => o.tokenNumber));
            }

            case 'order_by_merchant': {
                const merchantOrderId = req.nextUrl.searchParams.get('merchantOrderId');
                if (!merchantOrderId) return NextResponse.json({ error: 'merchantOrderId required' }, { status: 400 });
                const order = await findOrderByMerchantOrderId(merchantOrderId);
                if (!order) return NextResponse.json({ order: null });
                // Return minimal fields needed for cross-device recovery
                return NextResponse.json({
                    order: {
                        orderId: order.orderId,
                        tokenNumber: order.tokenNumber,
                        status: order.status,
                    },
                });
            }

            case 'settings':
                if (!isAdmin) return deny();
                return NextResponse.json(await getSettings());

            case 'chefs':
                return NextResponse.json(await getChefs());

            case 'chef_categories':
                return NextResponse.json(await getChefCategories());

            case 'export': {
                if (!isAdmin) return deny();
                const format = req.nextUrl.searchParams.get('format') ?? 'json';
                const [orders, menu_items, categories, chefs, settings] = await Promise.all([
                    getOrders(), getMenuItems(), getCategories(), getChefs(), getSettings(),
                ]);
                const payload = { orders, menu_items, categories, chefs, settings, exported_at: new Date().toISOString() };
                if (format === 'csv') {
                    const rows = orders as unknown as Record<string, unknown>[];
                    if (!rows.length) return new Response(
                        'orderId,tokenNumber,orderType,status,totalAmount,customerName,customerPhone,createdAt\n',
                        { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="orders.csv"' } }
                    );
                    const keys = ['orderId', 'tokenNumber', 'orderType', 'status', 'totalAmount', 'customerName', 'customerPhone', 'timestamp'];
                    const csv = [keys.join(','), ...rows.map(o => keys.map(k => JSON.stringify(o[k] ?? '')).join(','))].join('\n');
                    return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="orders.csv"' } });
                }
                return NextResponse.json(payload);
            }

            default:
                return NextResponse.json({ error: 'Unknown resource' }, { status: 400 });
        }
    } catch (err) {
        console.error('[GET /api/db]', resource, err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

// POST /api/db  body: { action, ...payload }
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { action } = body;
    const isAdmin = isAdminRequest(req);

    if (!ADMIN_ONLY.has(action) && !PUBLIC_POST.has(action)) {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    if (ADMIN_ONLY.has(action) && !isAdmin) return deny();

    switch (action) {

        // ── Menu (admin only) ─────────────────────────────────────────────────

        case 'menu_update_item': {
            const { id, updates } = body as { id: string; updates: Partial<MenuItem> };
            await updateMenuItemFields(id, updates as Record<string, unknown>);
            emit('menu', 'menu_items');
            return NextResponse.json({ ok: true });
        }

        case 'menu_add_item': {
            const { item } = body as { item: MenuItem };
            await saveMenuItems([item]);
            emit('menu', 'menu_items');
            return NextResponse.json({ ok: true });
        }

        case 'menu_delete_item': {
            const { id } = body as { id: string };
            await deleteMenuItemById(id);
            emit('menu', 'menu_items');
            return NextResponse.json({ ok: true });
        }

        case 'category_add': {
            const { cat } = body as { cat: import('@/lib/menuData').Category };
            const cats = await getCategories() as import('@/lib/menuData').Category[];
            await saveCategories([...cats, cat]);
            emit('menu', 'categories');
            return NextResponse.json({ ok: true });
        }

        case 'category_update': {
            const { id, updates } = body as { id: string; updates: Partial<import('@/lib/menuData').Category> };
            const cats = await getCategories() as import('@/lib/menuData').Category[];
            await saveCategories(cats.map(c => c.id === id ? { ...c, ...updates } : c));
            emit('menu', 'categories');
            return NextResponse.json({ ok: true });
        }

        case 'category_delete': {
            const { id } = body as { id: string };
            const cats = await getCategories() as import('@/lib/menuData').Category[];
            await saveCategories(cats.filter(c => c.id !== id));
            emit('menu', 'categories');
            return NextResponse.json({ ok: true });
        }

        // ── Modifier groups (admin only) ──────────────────────────────────────

        case 'modifier_group_upsert': {
            const { group } = body as { group: ModifierGroup };
            await upsertModifierGroup(group);
            emit('menu', 'modifier_groups');
            // Items resolve modifiers via groups, so menu_items effectively changed
            emit('menu', 'menu_items');
            return NextResponse.json({ ok: true });
        }

        case 'modifier_group_delete': {
            const { id } = body as { id: string };
            await deleteModifierGroupById(id);
            emit('menu', 'modifier_groups');
            emit('menu', 'menu_items');
            return NextResponse.json({ ok: true });
        }

        // ── Orders ────────────────────────────────────────────────────────────

        case 'order_add': {
            const { order, paymentToken, merchantOrderId } = body as {
                order: Order; paymentToken?: string; merchantOrderId?: string;
            };

            // Idempotency: if an order already exists for this merchantOrderId
            // (another device/tab placed it first), return its orderId. No token
            // consumption — the winning request already consumed it.
            if (merchantOrderId) {
                const existing = await findOrderByMerchantOrderId(merchantOrderId);
                if (existing) {
                    return NextResponse.json({ ok: true, orderId: existing.orderId, duplicate: true });
                }
                order.merchantOrderId = merchantOrderId;
            }

            // Server-authoritative payment gate. When paymentsEnabled is OFF,
            // the restaurant is in counter-payment mode: skip PhonePe token
            // verification and tag the order so staff knows to collect cash.
            // The setting is read fresh each request so flipping the toggle
            // takes effect immediately.
            const { paymentsEnabled } = await getSettings();
            if (paymentsEnabled) {
                if (!paymentToken || !await consumePaymentToken(paymentToken, order.totalAmount)) {
                    // Token already consumed (by another device winning the race) and
                    // the order exists under that merchantOrderId — return it.
                    if (merchantOrderId) {
                        const existing = await findOrderByMerchantOrderId(merchantOrderId);
                        if (existing) {
                            return NextResponse.json({ ok: true, orderId: existing.orderId, duplicate: true });
                        }
                    }
                    return NextResponse.json({ error: 'Invalid or expired payment token' }, { status: 403 });
                }
                order.paymentMethod = 'online';
            } else {
                order.paymentMethod = 'counter';
            }

            await appendOrder(order);
            emit('menu', 'orders');

            if (order.customerPhone) {
                const msg = formatOrderMessage({
                    customerName: order.customerName,
                    status: 'pending',
                    orderId: order.orderId,
                    tokenNumber: order.tokenNumber,
                    orderType: order.orderType,
                    pickupTime: order.preorderDetails?.pickupTime,
                    items: order.items.map(i => ({ name: i.menuItem.name, quantity: i.quantity })),
                    totalAmount: order.totalAmount,
                });
                sendWhatsApp(order.customerPhone, msg).catch(() => {});
            }
            return NextResponse.json({ ok: true });
        }

        case 'order_status': {
            const { orderId, status, items } = body as {
                orderId: string; status: Order['status']; items?: Order['items'];
            };
            await dbUpdateOrderStatus(orderId, status, items);
            emit('menu', 'orders');

            const orders = await getOrders();
            const updatedOrder = orders.find(o => o.orderId === orderId);
            if (updatedOrder?.customerPhone) {
                const msg = formatOrderMessage({
                    customerName: updatedOrder.customerName,
                    status,
                    orderId,
                    tokenNumber: updatedOrder.tokenNumber,
                    orderType: updatedOrder.orderType,
                    pickupTime: updatedOrder.preorderDetails?.pickupTime,
                    items: updatedOrder.items.map(i => ({ name: i.menuItem.name, quantity: i.quantity })),
                    totalAmount: updatedOrder.totalAmount,
                });
                sendWhatsApp(updatedOrder.customerPhone, msg).catch(() => {});
            }
            return NextResponse.json({ ok: true });
        }

        // ── Settings (admin only) ─────────────────────────────────────────────

        case 'settings_save': {
            await saveSettings(body.settings);
            emit('menu', 'settings');
            return NextResponse.json({ ok: true });
        }

        // ── Chefs (admin only) ────────────────────────────────────────────────

        case 'chef_upsert': {
            const { chef } = body as { chef: Chef };
            const chefs = await getChefs();
            const idx = chefs.findIndex(c => c.id === chef.id);
            if (idx >= 0) chefs[idx] = chef; else chefs.push(chef);
            await saveChefs(chefs);
            emit('kitchen', 'chefs');
            return NextResponse.json({ ok: true });
        }

        case 'chef_delete': {
            const { id } = body as { id: string };
            await saveChefs((await getChefs()).filter(c => c.id !== id));
            await saveChefCategories((await getChefCategories()).filter(c => c.chef_id !== id));
            emit('kitchen', 'chefs');
            return NextResponse.json({ ok: true });
        }

        case 'chef_categories_set': {
            const { chef_id, category_ids } = body as { chef_id: string; category_ids: string[] };
            const existing = await getChefCategories();
            const kept = existing.filter(c => c.chef_id !== chef_id && !category_ids.includes(c.category_id));
            const added: ChefCategory[] = category_ids.map(cid => ({ chef_id, category_id: cid }));
            await saveChefCategories([...kept, ...added]);
            emit('kitchen', 'chef_categories');
            return NextResponse.json({ ok: true });
        }

        // ── Analytics (public, append-only) ──────────────────────────────────

        case 'log_cancellation':
            await logCancellation(body.entry);
            return NextResponse.json({ ok: true });

        case 'log_cart_abandonment':
            await logCartAbandonment(body.entry);
            return NextResponse.json({ ok: true });

        case 'log_payment':
            await logPayment(body.entry);
            return NextResponse.json({ ok: true });

        default:
            return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
}
