import { NextRequest, NextResponse } from 'next/server';
import {
    getMenuItems, saveMenuItems,
    getCategories,
    getOrders, appendOrder, updateOrderStatus as dbUpdateOrderStatus,
    getSettings, saveSettings,
    getChefs, saveChefs,
    getChefCategories, saveChefCategories,
    logCancellation, logCartAbandonment, logPayment,
} from '@/lib/localDb';
import type { Order, Chef, ChefCategory } from '@/lib/localDb';
import { menuItems as seedMenuItems } from '@/lib/menuData';
import type { MenuItem } from '@/lib/menuData';
import { emit } from '@/lib/serverEvents';

// GET /api/db?resource=menu_items|categories|orders|settings|chefs|chef_categories
export async function GET(req: NextRequest) {
    const resource = req.nextUrl.searchParams.get('resource');
    const tokenId = req.nextUrl.searchParams.get('tokenId');
    const orderId = req.nextUrl.searchParams.get('orderId');

    switch (resource) {
        case 'menu_items':
            return NextResponse.json(getMenuItems());

        case 'categories':
            return NextResponse.json(getCategories());

        case 'orders': {
            const orders = getOrders();
            // Filter by tokenId for customer tracking
            if (tokenId) {
                const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
                const filtered = orders.filter(o =>
                    o.tokenId === tokenId &&
                    new Date(o.timestamp).getTime() > twoHoursAgo
                );
                if (orderId) return NextResponse.json(filtered.filter(o => o.orderId === orderId));
                return NextResponse.json(filtered);
            }
            return NextResponse.json(orders);
        }

        case 'active_tokens': {
            const orders = getOrders();
            const active = orders
                .filter(o => o.status !== 'delivered')
                .map(o => o.tokenNumber);
            return NextResponse.json(active);
        }

        case 'settings':
            return NextResponse.json(getSettings());

        case 'chefs':
            return NextResponse.json(getChefs());

        case 'chef_categories':
            return NextResponse.json(getChefCategories());

        default:
            return NextResponse.json({ error: 'Unknown resource' }, { status: 400 });
    }
}

// POST /api/db  body: { action, ...payload }
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { action } = body;

    switch (action) {

        // ── Menu ──────────────────────────────────────────────────────────────

        case 'menu_update_item': {
            const { id, updates } = body as { id: string; updates: Partial<MenuItem> };
            const items = getMenuItems() as MenuItem[];
            const next = items.map(i => i.id === id ? { ...i, ...updates } : i);
            saveMenuItems(next);
            emit('menu');
            return NextResponse.json({ ok: true });
        }

        case 'menu_add_item': {
            const { item } = body as { item: MenuItem };
            const items = getMenuItems() as MenuItem[];
            saveMenuItems([...items, item]);
            emit('menu');
            return NextResponse.json({ ok: true });
        }

        case 'menu_delete_item': {
            const { id } = body as { id: string };
            const items = getMenuItems() as MenuItem[];
            saveMenuItems(items.filter(i => i.id !== id));
            emit('menu');
            return NextResponse.json({ ok: true });
        }

        // ── Orders ────────────────────────────────────────────────────────────

        case 'order_add': {
            const { order } = body as { order: Order };
            appendOrder(order);
            emit('orders');
            emit('menu'); // kitchen polling orders via menu channel
            return NextResponse.json({ ok: true });
        }

        case 'order_status': {
            const { orderId, status, items } = body as {
                orderId: string;
                status: Order['status'];
                items?: Order['items'];
            };
            dbUpdateOrderStatus(orderId, status, items);
            emit('orders');
            emit('menu');
            return NextResponse.json({ ok: true });
        }

        // ── Settings ──────────────────────────────────────────────────────────

        case 'settings_save': {
            const { settings } = body;
            saveSettings(settings);
            emit('menu');
            return NextResponse.json({ ok: true });
        }

        // ── Chefs ─────────────────────────────────────────────────────────────

        case 'chef_upsert': {
            const { chef } = body as { chef: Chef };
            const chefs = getChefs();
            const idx = chefs.findIndex(c => c.id === chef.id);
            if (idx >= 0) chefs[idx] = chef;
            else chefs.push(chef);
            saveChefs(chefs);
            emit('kitchen');
            return NextResponse.json({ ok: true });
        }

        case 'chef_delete': {
            const { id } = body as { id: string };
            const chefs = getChefs().filter(c => c.id !== id);
            saveChefs(chefs);
            const cc = getChefCategories().filter(c => c.chef_id !== id);
            saveChefCategories(cc);
            emit('kitchen');
            return NextResponse.json({ ok: true });
        }

        case 'chef_categories_set': {
            const { chef_id, category_ids } = body as { chef_id: string; category_ids: string[] };
            let cc = getChefCategories().filter(c =>
                c.chef_id !== chef_id && !category_ids.includes(c.category_id)
            );
            const newRows: ChefCategory[] = category_ids.map(cid => ({ chef_id, category_id: cid }));
            cc = [...cc, ...newRows];
            saveChefCategories(cc);
            emit('kitchen');
            return NextResponse.json({ ok: true });
        }

        // ── Analytics ─────────────────────────────────────────────────────────

        case 'log_cancellation': {
            logCancellation(body.entry);
            return NextResponse.json({ ok: true });
        }

        case 'log_cart_abandonment': {
            logCartAbandonment(body.entry);
            return NextResponse.json({ ok: true });
        }

        case 'log_payment': {
            logPayment(body.entry);
            return NextResponse.json({ ok: true });
        }

        default:
            return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
}
