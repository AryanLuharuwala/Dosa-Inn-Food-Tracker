/**
 * Server-side helper to send WhatsApp messages via the restaurant-bot service.
 * Called from API routes — never from client components.
 */

function getServiceUrl(): string | null {
    const url = process.env.WA_SERVICE_URL?.trim().replace(/\/$/, '');
    if (url) return url;
    // Legacy: old deploys used WA_SERVICE_PORT on localhost
    const port = process.env.WA_SERVICE_PORT;
    if (port) return `http://127.0.0.1:${port}`;
    return null;
}

export async function sendWhatsApp(phone: string, message: string): Promise<void> {
    const base = getServiceUrl();
    if (!base) return; // Service not configured — silent no-op

    const token = process.env.BOT_API_TOKEN;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const res = await fetch(`${base}/send`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ to: phone, message }),
            // Don't let a slow bot block the order response
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('[WA] send failed:', res.status, err);
        }
    } catch (err) {
        // Service unreachable / timeout — don't break the order flow
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
