/**
 * Server-side helper to send WhatsApp messages via the restaurant-bot service.
 * Called from API routes — never from client components.
 */

import { rateLimited } from '@/lib/apiAuth';
import { logDebugEvent } from '@/lib/debugLog';

function getServiceUrl(): string | null {
    const url = process.env.WA_SERVICE_URL?.trim().replace(/\/$/, '');
    if (url) return url;
    // Legacy: old deploys used WA_SERVICE_PORT on localhost
    const port = process.env.WA_SERVICE_PORT;
    if (port) return `http://127.0.0.1:${port}`;
    return null;
}

export async function sendWhatsApp(
    phone: string,
    message: string,
    source: 'order' | 'debug_test' | 'marketing' | 'auto_reply' = 'order',
    imageUrl?: string,
): Promise<void> {
    const base = getServiceUrl();
    if (!base) {
        // Service not configured — no-op for real orders, but the debug panel
        // needs to know why nothing happened rather than silently "succeeding".
        if (source === 'debug_test') {
            logDebugEvent({ type: 'whatsapp_send', phone: phone.replace(/\D/g, ''), allowed: true, reason: `${source}: WA_SERVICE_URL/PORT not configured` });
        }
        return;
    }

    // order_add is a public, unauthenticated endpoint — the caller controls
    // customerPhone freely, so a forged number could otherwise be spammed via
    // repeated fake orders. Cap sends per number regardless of how many
    // "orders" reference it.
    const digits = phone.replace(/\D/g, '');
    if (await rateLimited(`wa:${digits}`, 8, 2 * 60 * 60_000)) {
        console.warn('[WA] rate limit hit for', digits);
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: false, reason: `${source}: rate limited` });
        return;
    }

    const token = process.env.BOT_API_TOKEN;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const res = await fetch(`${base}/send`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ to: phone, message, imageUrl }),
            // Don't let a slow bot block the order response
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('[WA] send failed:', res.status, err);
            logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: `${source}: failed (${res.status})` });
            return;
        }
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: `${source}: sent` });
    } catch (err) {
        // Service unreachable / timeout — don't break the order flow
        console.warn('[WA] service unavailable:', (err as Error).message);
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: `${source}: service unavailable` });
    }
}

// Poll sends belong to a live, in-progress conversation the customer
// themselves initiated by tapping through — unlike order/marketing sends,
// the recipient can't be forged by a third party (there's no client-facing
// form that lets someone else name this phone number), so this uses a
// separate, more generous cap than the 8/2hr order-status limit rather than
// risk truncating a legitimate multi-category order mid-flow.
export async function sendWhatsAppPoll(
    phone: string,
    name: string,
    values: string[],
    selectableCount: number,
): Promise<string | null> {
    const base = getServiceUrl();
    if (!base) return null;

    const digits = phone.replace(/\D/g, '');
    if (await rateLimited(`wa_poll:${digits}`, 40, 2 * 60 * 60_000)) {
        console.warn('[WA] poll rate limit hit for', digits);
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: false, reason: 'poll: rate limited' });
        return null;
    }

    const token = process.env.BOT_API_TOKEN;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
        const res = await fetch(`${base}/send-poll`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ to: phone, name, values, selectableCount }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.warn('[WA] send-poll failed:', res.status, err);
            logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: `poll: failed (${res.status})` });
            return null;
        }
        const data = await res.json() as { ok: boolean; pollId?: string };
        if (!data.ok || !data.pollId) {
            logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: 'poll: not delivered (number not on WhatsApp?)' });
            return null;
        }
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: 'poll: sent' });
        return data.pollId;
    } catch (err) {
        console.warn('[WA] send-poll service unavailable:', (err as Error).message);
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: true, reason: 'poll: service unavailable' });
        return null;
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
