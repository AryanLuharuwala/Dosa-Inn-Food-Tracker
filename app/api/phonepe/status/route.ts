import { NextRequest, NextResponse } from 'next/server';

const IS_SANDBOX = process.env.PHONEPE_ENV !== 'production';

const OAUTH_URL = IS_SANDBOX
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'
    : 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';

const STATUS_BASE = IS_SANDBOX
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order'
    : 'https://api.phonepe.com/apis/pg/checkout/v2/order';
// Status endpoint: {STATUS_BASE}/{merchantOrderId}/status

async function getAccessToken(): Promise<string> {
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
    return data.access_token as string;
}

export async function GET(req: NextRequest) {
    const orderId = req.nextUrl.searchParams.get('orderId');
    if (!orderId) {
        return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
    }

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

        // state: COMPLETED | FAILED | PENDING | EXPIRED
        return NextResponse.json({
            state: data.state,
            orderId: data.orderId,
            amount: data.amount,
            paymentDetails: data.paymentDetails ?? null,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
