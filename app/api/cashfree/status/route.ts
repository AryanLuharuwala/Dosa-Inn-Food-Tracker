import { NextRequest, NextResponse } from 'next/server';
import { issuePaymentToken } from '@/lib/paymentTokens';
import { rateLimited, getClientIp, getVisitorId } from '@/lib/apiAuth';

const IS_SANDBOX = process.env.CASHFREE_ENV !== 'production';

const LINKS_BASE = IS_SANDBOX
    ? 'https://sandbox.cashfree.com/pg/links'
    : 'https://api.cashfree.com/pg/links';

const API_VERSION = '2023-08-01';

// Cashfree link statuses → normalised states used by payment-result page
// PAID → COMPLETED, CANCELLED → FAILED, EXPIRED → EXPIRED, else → PENDING
function normaliseStatus(s: string): 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'PENDING' {
    if (s === 'PAID') return 'COMPLETED';
    if (s === 'CANCELLED') return 'FAILED';
    if (s === 'EXPIRED') return 'EXPIRED';
    return 'PENDING';
}

export async function GET(req: NextRequest) {
    const ip = getClientIp(req);

    if (await rateLimited(`cashfree-status:${ip}`, 20, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const orderId = req.nextUrl.searchParams.get('orderId');
    if (!orderId) {
        return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    if (!/^TMP-\d+-[A-Z0-9]+$/.test(orderId)) {
        return NextResponse.json({ error: 'Invalid orderId' }, { status: 400 });
    }

    const visitorId = getVisitorId(req) ?? ip;

    try {
        const res = await fetch(`${LINKS_BASE}/${orderId}`, {
            headers: {
                'x-client-id': process.env.CASHFREE_APP_ID!,
                'x-client-secret': process.env.CASHFREE_SECRET_KEY!,
                'x-api-version': API_VERSION,
            },
        });

        const data = await res.json();
        console.log('[Cashfree status] HTTP', res.status, JSON.stringify(data, null, 2));

        if (!res.ok) {
            return NextResponse.json({ error: data }, { status: res.status });
        }

        const state = normaliseStatus(data.link_status as string);
        let paymentToken: string | undefined;

        if (state === 'COMPLETED') {
            // Cashfree returns link_amount in rupees (not paisa)
            const amountRupees = data.link_amount as number;
            paymentToken = await issuePaymentToken({ merchantOrderId: orderId, amountRupees, visitorId });
        }

        return NextResponse.json({
            state,
            orderId: data.link_id,
            amount: Math.round((data.link_amount as number) * 100), // expose in paisa for compatibility
            paymentToken,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
