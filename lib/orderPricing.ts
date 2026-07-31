/**
 * Server-side price authority for orders. order_add is a public endpoint —
 * the client sends menuItem.price, selectedAddOns[].price, extra.price, and
 * totalAmount, but none of that can be trusted (a modified request could
 * claim any price for real items). This recomputes every price from the
 * live menu and overwrites the order in place before it's ever stored,
 * billed, or checked against a payment.
 */

import { getMenuItems } from './localDb';
import type { Order } from './localDb';

const MAX_QTY = 50;

type Priced = { id: string; name: string; price: number };

export async function verifyAndPriceOrder(order: Order): Promise<{ ok: true } | { ok: false; reason: string }> {
    const menuItems = await getMenuItems();
    const itemById = new Map(menuItems.map(i => [i.id, i]));

    // Modifier groups are shared/deduplicated across items, so ids are
    // unique system-wide — safe to flatten into one lookup.
    const modifierById = new Map<string, Priced>();
    for (const item of menuItems) {
        for (const m of [...item.addOns, ...item.extras]) modifierById.set(m.id, m);
    }

    if (!Array.isArray(order.items) || order.items.length === 0) {
        return { ok: false, reason: 'Order has no items' };
    }

    let total = 0;

    for (const line of order.items) {
        const realItem = itemById.get(line.menuItem?.id);
        if (!realItem) return { ok: false, reason: `Unknown menu item: ${line.menuItem?.id}` };
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QTY) {
            return { ok: false, reason: 'Invalid item quantity' };
        }
        let addOnsTotal = 0;
        const realAddOns: Priced[] = [];
        for (const a of line.selectedAddOns ?? []) {
            const m = modifierById.get(a.id);
            if (!m) return { ok: false, reason: `Unknown add-on: ${a.id}` };
            addOnsTotal += m.price;
            realAddOns.push({ id: m.id, name: m.name, price: m.price });
        }
        line.menuItem = { id: realItem.id, name: realItem.name, price: realItem.price };
        line.selectedAddOns = realAddOns;
        line.totalPrice = (realItem.price + addOnsTotal) * line.quantity;
        total += line.totalPrice;
    }

    for (const e of order.extras ?? []) {
        const m = modifierById.get(e.extra?.id);
        if (!m) return { ok: false, reason: `Unknown extra: ${e.extra?.id}` };
        if (!Number.isInteger(e.quantity) || e.quantity < 1 || e.quantity > MAX_QTY) {
            return { ok: false, reason: 'Invalid extra quantity' };
        }
        e.extra = { id: m.id, name: m.name, price: m.price };
        total += m.price * e.quantity;
    }

    order.totalAmount = Math.round(total * 100) / 100;
    return { ok: true };
}
