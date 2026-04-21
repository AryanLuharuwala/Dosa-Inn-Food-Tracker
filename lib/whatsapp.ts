/**
 * Server-side helper to send WhatsApp messages via the local WA service.
 * Called from API routes — never from client components.
 */

const WA_SERVICE = `http://127.0.0.1:${process.env.WA_SERVICE_PORT || 3478}`;

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
    try {
        const res = await fetch(`${WA_SERVICE}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: phone, message }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('[WA] send failed:', err);
        }
    } catch (err) {
        // Service not running — silently skip, don't break order flow
        console.warn('[WA] service unavailable:', (err as Error).message);
    }
}

export function formatOrderMessage(params: {
    customerName?: string;
    status: string;
    orderId: string;
    tokenNumber: number;
    orderType?: string;
    pickupTime?: string;
    items: Array<{ name: string; quantity: number }>;
    totalAmount: number;
}): string {
    const { customerName, status, orderId, tokenNumber, orderType, pickupTime, items, totalAmount } = params;

    const greeting = customerName ? `Hi ${customerName}! ` : '';
    const itemsText = items.map(i => `  • ${i.quantity}× ${i.name}`).join('\n');
    const ref = orderType === 'preorder'
        ? `Parcel #${orderId.slice(-4).toUpperCase()}`
        : `Token #${tokenNumber}`;

    const statusMessages: Record<string, string> = {
        pending:    `${greeting}✅ *Order Received!*\n\n${ref}\n${itemsText}\n\n💰 Total: ₹${totalAmount}\n\nWe'll start preparing your order shortly.`,
        preparing:  `${greeting}👨‍🍳 *Your order is being prepared!*\n\n${ref} is now in the kitchen. Estimated time: ~15 min.`,
        ready:      `${greeting}🔔 *Your order is ready!*\n\n${ref} — please collect your order${orderType === 'preorder' && pickupTime ? ` at ${pickupTime}` : ''}.`,
        delivered:  `${greeting}🎉 *Order complete!*\n\nThank you for dining with us. Enjoy your meal! 🍽️`,
        served:     `${greeting}🎉 *Order served!*\n\nThank you for dining with us. Hope you enjoyed your meal! 🍽️`,
    };

    return statusMessages[status] ?? `${greeting}Your order ${ref} status: *${status}*`;
}
