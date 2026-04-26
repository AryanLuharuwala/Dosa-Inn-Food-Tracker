import { NextRequest, NextResponse } from 'next/server';
import { issuePaymentToken } from '@/lib/paymentTokens';
import { rateLimited, getClientIp, getVisitorId } from '@/lib/apiAuth';

const IS_SANDBOX = process.env.PHONEPE_ENV !== 'production';

const OAUTH_URL = IS_SANDBOX
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'
    : 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';

const STATUS_BASE = IS_SANDBOX
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order'
    : 'https://api.phonepe.com/apis/pg/checkout/v2/order';
// Status endpoint: {STATUS_BASE}/{merchantOrderId}/status

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

    const params = new URLSearchParams({
        client_id: process.env.PHONEPE_CLIENT_ID!,
        client_version: process.env.PHONEPE_CLIENT_VERSION || '1',
        client_secret: process.env.PHONEPE_CLIENT_SECRET!,
        grant_type: 'client_credentials',
    });

    const res = await fetch(OAUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!res.ok) throw new Error(`PhonePe OAuth failed: ${await res.text()}`);
    const data = await res.json();

    // Cache for 5 minutes less than the actual expiry to avoid edge expiry races
    const ttlMs = ((data.expires_in as number) ?? 3600) * 1000 - 5 * 60 * 1000;
    cachedToken = { value: data.access_token as string, expiresAt: Date.now() + ttlMs };

    return cachedToken.value;
}

export async function GET(req: NextRequest) {
    const ip = getClientIp(req);

    // Rate limit: 20 status checks per IP per minute
    if (await rateLimited(`phonepe-status:${ip}`, 20, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const orderId = req.nextUrl.searchParams.get('orderId');
    if (!orderId) {
        return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

    // Validate format — our IDs always look like TMP-<timestamp>-<random>
    if (!/^TMP-\d+-[A-Z0-9]+$/.test(orderId)) {
        return NextResponse.json({ error: 'Invalid orderId' }, { status: 400 });
    }

    const visitorId = getVisitorId(req) ?? ip;

    try {
        const accessToken = await getAccessToken();

        const res = await fetch(`${STATUS_BASE}/${orderId}/status`, {
            headers: { 'Authorization': `O-Bearer ${accessToken}` },
        });

        const data = await res.json();
        console.log('[PhonePe status] HTTP', res.status, JSON.stringify(data, null, 2));

        if (!res.ok) {
            return NextResponse.json({ error: data }, { status: res.status });
        }

        // On COMPLETED: issue a server-side single-use payment token tied to the
        // verified amount. The client must present this token when calling order_add.
        // Without it, order_add is rejected — this closes the free-order attack.
        let paymentToken: string | undefined;
        if (data.state === 'COMPLETED') {
            const amountRupees = (data.amount as number) / 100;
            paymentToken = await issuePaymentToken({ merchantOrderId: orderId, amountRupees, visitorId });
        }

        return NextResponse.json({
            state: data.state,
            orderId: data.orderId,
            amount: data.amount,
            paymentToken, // only present on COMPLETED
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
