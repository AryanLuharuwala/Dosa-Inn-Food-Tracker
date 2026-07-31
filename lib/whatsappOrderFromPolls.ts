/**
 * Builds and creates a real order from a settled poll-ordering conversation.
 * Deliberately a parallel, lightweight implementation reusing the same
 * primitives app/api/db/route.ts's order_add uses (verifyAndPriceOrder,
 * appendOrder, the auto-print block) rather than refactoring that
 * already-verified route — its payment-token/merchantOrderId logic doesn't
 * apply here at all (no online payment is possible from a chat).
 */

import { randomBytes } from 'crypto';
import { getOrders, appendOrder, getMenuItems, getSettings } from '@/lib/localDb';
import type { Order } from '@/lib/localDb';
import { verifyAndPriceOrder } from '@/lib/orderPricing';
import { buildKOTDoc } from '@/lib/printer/receipt';
import { renderDocServer } from '@/lib/printer/render.server';
import { enqueuePrintJob, autoKotDedupKey } from '@/lib/printer/printerDb';
import { rateLimited } from '@/lib/apiAuth';
import { sendWhatsApp, formatOrderMessage } from '@/lib/whatsapp';
import type { Selections } from '@/lib/whatsappConversation';

async function pickUniqueToken(): Promise<number> {
    const orders = await getOrders();
    const active = new Set(orders.filter(o => o.status !== 'delivered').map(o => o.tokenNumber));
    if (active.size >= 200) return Math.floor(Math.random() * 200) + 1;
    let token: number;
    do { token = Math.floor(Math.random() * 200) + 1; } while (active.has(token));
    return token;
}

export async function createOrderFromPollSelections(
    phone: string,
    selections: Selections,
): Promise<{ ok: true; orderId: string } | { ok: false; reason: string }> {
    const itemIds = Object.keys(selections.quantities).filter(id => (selections.quantities[id] ?? 0) > 0);
    if (itemIds.length === 0) {
        return { ok: false, reason: 'No items selected' };
    }

    // Same phone-based guard order_add already applies to the public
    // endpoint — WhatsApp ordering can't be used to route around it.
    if (await rateLimited(`order_add:phone:${phone}`, 5, 60 * 60_000)) {
        return { ok: false, reason: 'Too many orders for this phone number recently' };
    }

    const menuItems = await getMenuItems();
    const itemById = new Map(menuItems.map(i => [i.id, i]));

    const items: Order['items'] = [];
    for (const id of itemIds) {
        const item = itemById.get(id);
        if (!item) continue; // stale selection (item changed mid-conversation) — skip, don't fail the whole order
        items.push({
            menuItem: { id: item.id, name: item.name, price: item.price },
            quantity: selections.quantities[id],
            selectedAddOns: [],
            totalPrice: item.price * selections.quantities[id], // verifyAndPriceOrder recomputes this authoritatively below
        });
    }
    if (items.length === 0) {
        return { ok: false, reason: 'Selected items are no longer available' };
    }

    const tokenNumber = await pickUniqueToken();
    const orderId = `#${tokenNumber}-RDA-WA${randomBytes(2).toString('hex').toUpperCase()}`;

    const order: Order = {
        orderId,
        orderType: 'preorder',
        tableNumber: null,
        preorderDetails: { pickupTime: 'ASAP', customerName: 'WhatsApp Customer', customerPhone: phone },
        tokenNumber,
        items,
        extras: [],
        totalAmount: 0, // verifyAndPriceOrder fills this in from real menu prices
        timestamp: new Date().toISOString(),
        status: 'pending',
        customerPhone: phone,
        paymentMethod: 'counter', // no way to collect online payment from inside a chat
    };

    const priced = await verifyAndPriceOrder(order);
    if (!priced.ok) return { ok: false, reason: priced.reason };

    await appendOrder(order);

    const settings = await getSettings();
    if (settings.autoPrintOrders && !await rateLimited(autoKotDedupKey(order.orderId), 1, 10 * 60_000)) {
        try {
            const restaurantName = settings.restaurantName ?? 'Restaurant';
            const doc = buildKOTDoc(order, restaurantName);
            const { data, width, height } = await renderDocServer(doc);
            await enqueuePrintJob(data, width, height, 'kot', settings.kotCopies ?? 1);
        } catch (err) {
            console.warn('[whatsapp-order] auto-enqueue KOT failed:', err);
        }
    }

    const msg = formatOrderMessage({
        status: 'pending',
        orderId: order.orderId,
        tokenNumber: order.tokenNumber,
        orderType: 'preorder',
        items: order.items.map(i => ({ name: i.menuItem.name, quantity: i.quantity })),
        totalAmount: order.totalAmount,
    });
    await sendWhatsApp(phone, msg, 'order');

    return { ok: true, orderId: order.orderId };
}
