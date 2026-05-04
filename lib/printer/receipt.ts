import type { DocLine } from './types';
import type { Order } from '@/lib/localDb';
import type { BillTemplate } from '@/lib/billTemplate';
import { DEFAULT_BILL_TEMPLATE } from '@/lib/billTemplate';

function padCols(left: string, right: string, totalWidth = 32): string {
    const space = Math.max(1, totalWidth - left.length - right.length);
    return left + ' '.repeat(space) + right;
}

export function buildTestDoc(restaurantName: string): DocLine[] {
    return [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'huge' },
        { kind: 'text', text: 'PRINTER TEST', align: 'center', bold: true },
        { kind: 'divider' },
        { kind: 'text', text: 'If you can read this, the printer is working.' },
        { kind: 'space' },
        { kind: 'text', text: 'Bold text test', bold: true },
        { kind: 'text', text: 'LARGE TEXT', size: 'large', bold: true, align: 'center' },
        { kind: 'space' },
        { kind: 'text', text: `Time: ${new Date().toLocaleTimeString('en-IN')}`, align: 'center' },
    ];
}

export function buildKOTDoc(order: Order, restaurantName: string): DocLine[] {
    const label =
        order.orderType === 'preorder' ? 'PARCEL' :
        order.tableNumber && order.tableNumber !== '0' ? `TABLE ${order.tableNumber}` :
        `TOKEN ${order.tokenNumber}`;
    const time = new Date(order.timestamp).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true,
    });

    const doc: DocLine[] = [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'large' },
        { kind: 'text', text: 'KITCHEN ORDER', align: 'center' },
        { kind: 'divider' },
        { kind: 'text', text: label, bold: true, align: 'center', size: 'huge' },
        { kind: 'divider' },
        { kind: 'text', text: `Order: ${order.orderId}` },
        { kind: 'text', text: `Time:  ${time}` },
    ];
    if (order.preorderDetails?.pickupTime) {
        doc.push({ kind: 'text', text: `Pickup: ${order.preorderDetails.pickupTime}` });
    }
    if (order.customerName) {
        doc.push({ kind: 'text', text: `Name:  ${order.customerName}` });
    }
    doc.push({ kind: 'divider' });
    for (const it of order.items) {
        doc.push({ kind: 'text', text: `${it.quantity} x ${it.menuItem.name}`, bold: true });
        for (const a of it.selectedAddOns ?? []) {
            doc.push({ kind: 'text', text: `   + ${a.name}` });
        }
    }
    for (const e of order.extras ?? []) {
        doc.push({ kind: 'text', text: `${e.quantity} x ${e.extra.name}`, bold: true });
    }
    doc.push({ kind: 'divider' });
    return doc;
}

export function buildBillDoc(order: Order, restaurantName: string, template?: BillTemplate): DocLine[] {
    const tmpl = template ?? DEFAULT_BILL_TEMPLATE;
    const time = new Date(order.timestamp).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const payLine =
        order.paymentMethod === 'counter' ? '** PAY AT COUNTER **' :
        order.paymentMethod === 'online'  ? '** PAID ONLINE **'   : '';

    const doc: DocLine[] = [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'large' },
        { kind: 'divider' },
        { kind: 'text', text: `Order: ${order.orderId}` },
        { kind: 'text', text: `Token: ${order.tokenNumber}` },
    ];
    if (order.tableNumber && order.tableNumber !== '0') {
        doc.push({ kind: 'text', text: `Table: ${order.tableNumber}` });
    }
    doc.push({ kind: 'text', text: `Time:  ${time}` });
    doc.push({ kind: 'divider' });

    let totalUnits = 0;
    for (const it of order.items) {
        const name = it.menuItem.name.length > 18 ? it.menuItem.name.slice(0, 18) : it.menuItem.name;
        doc.push({ kind: 'text', text: padCols(`${it.quantity} x ${name}`, `Rs.${it.totalPrice}`) });
        totalUnits += it.quantity;
        for (const a of it.selectedAddOns ?? []) {
            doc.push({ kind: 'text', text: padCols(`   + ${a.name}`, `Rs.${a.price}`) });
        }
    }
    for (const e of order.extras ?? []) {
        doc.push({ kind: 'text', text: padCols(`${e.quantity} x ${e.extra.name}`, `Rs.${e.extra.price * e.quantity}`) });
        totalUnits += e.quantity;
    }
    doc.push({ kind: 'divider' });
    doc.push({ kind: 'text', text: padCols('TOTAL', `Rs.${order.totalAmount}`), bold: true, size: 'large' });
    doc.push({ kind: 'text', text: `Items: ${totalUnits}` });
    if (payLine) {
        doc.push({ kind: 'space' });
        doc.push({ kind: 'text', text: payLine, bold: true, align: 'center' });
    }
    doc.push({ kind: 'space' });
    doc.push({ kind: 'text', text: 'Thank you!', align: 'center' });

    if (tmpl.footer.showQrCode && tmpl.footer.upiId) {
        doc.push({ kind: 'space', px: 12 });
        doc.push({ kind: 'qr', data: `upi://pay?pa=${tmpl.footer.upiId}`, size: 180 });
        if (tmpl.footer.qrLabel) {
            doc.push({ kind: 'text', text: tmpl.footer.qrLabel, align: 'center' });
        }
    }

    return doc;
}

export function buildStatsDoc(orders: Order[], restaurantName: string): DocLine[] {
    const today = new Date();
    const todayStr = today.toDateString();
    const todayOrders = orders.filter(o => new Date(o.timestamp).toDateString() === todayStr);
    const revenue = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
    const count = todayOrders.length;
    const aov = count > 0 ? Math.round(revenue / count) : 0;
    const status = {
        pending: todayOrders.filter(o => o.status === 'pending').length,
        preparing: todayOrders.filter(o => o.status === 'preparing').length,
        ready: todayOrders.filter(o => o.status === 'ready').length,
        delivered: todayOrders.filter(o => o.status === 'delivered').length,
    };
    const dineIn = todayOrders.filter(o => o.orderType === 'dine-in').length;
    const preorder = todayOrders.filter(o => o.orderType === 'preorder').length;
    const itemCounts: Record<string, number> = {};
    for (const o of todayOrders) for (const it of o.items) {
        itemCounts[it.menuItem.name] = (itemCounts[it.menuItem.name] ?? 0) + it.quantity;
    }
    const top = Object.entries(itemCounts).sort(([, a], [, b]) => b - a).slice(0, 5);

    const doc: DocLine[] = [
        { kind: 'text', text: restaurantName, bold: true, align: 'center', size: 'large' },
        { kind: 'text', text: 'DAILY SUMMARY', align: 'center' },
        { kind: 'text', text: today.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }), align: 'center' },
        { kind: 'divider' },
        { kind: 'text', text: 'REVENUE', bold: true },
        { kind: 'text', text: padCols('Total', `Rs.${revenue}`), bold: true, size: 'large' },
        { kind: 'text', text: padCols('Orders', String(count)) },
        { kind: 'text', text: padCols('Avg order', `Rs.${aov}`) },
        { kind: 'divider' },
        { kind: 'text', text: 'STATUS', bold: true },
        { kind: 'text', text: padCols('Pending', String(status.pending)) },
        { kind: 'text', text: padCols('Preparing', String(status.preparing)) },
        { kind: 'text', text: padCols('Ready', String(status.ready)) },
        { kind: 'text', text: padCols('Delivered', String(status.delivered)) },
        { kind: 'divider' },
        { kind: 'text', text: 'ORDER TYPE', bold: true },
        { kind: 'text', text: padCols('Dine-in', String(dineIn)) },
        { kind: 'text', text: padCols('Preorder', String(preorder)) },
    ];
    if (top.length > 0) {
        doc.push({ kind: 'divider' });
        doc.push({ kind: 'text', text: 'TOP SELLERS', bold: true });
        for (const [name, qty] of top) {
            const truncated = name.length > 22 ? name.slice(0, 22) : name;
            doc.push({ kind: 'text', text: padCols(truncated, `x${qty}`) });
        }
    }
    return doc;
}
