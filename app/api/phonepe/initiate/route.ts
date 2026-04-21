import { NextRequest, NextResponse } from 'next/server';

const IS_SANDBOX = process.env.PHONEPE_ENV !== 'production';

const OAUTH_URL = IS_SANDBOX
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token'
    : 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token';

const PAY_URL = IS_SANDBOX
    ? 'https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay'
    : 'https://api.phonepe.com/apis/pg/checkout/v2/pay';

// Module-level token cache — survives across requests in the same worker process
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;

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

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`PhonePe OAuth failed: ${err}`);
    }

    const data = await res.json();
    // PhonePe tokens typically expire in 3600s; cache with a 60s safety margin
    const ttl = ((data.expires_in as number) || 3600) - 60;
    tokenCache = { token: data.access_token as string, expiresAt: Date.now() + ttl * 1000 };
    return tokenCache.token;
}

export async function POST(req: NextRequest) {
    try {
        const { merchantOrderId, amount } = await req.json();

        if (!merchantOrderId || !amount) {
            return NextResponse.json({ error: 'merchantOrderId and amount are required' }, { status: 400 });
        }

        // Prefer explicit config; fall back to X-Forwarded-* (Azure reverse proxy);
        // last resort is the request URL (which inside a container is the pod hostname)
        const forwardedHost = req.headers.get('x-forwarded-host');
        const forwardedProto = req.headers.get('x-forwarded-proto');
        const rawConfig = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, '');
        const configBase = rawConfig
            ? (/^https?:\/\//i.test(rawConfig) ? rawConfig : `https://${rawConfig}`)
            : null;
        const baseUrl =
            configBase ||
            (forwardedHost ? `${forwardedProto ?? 'https'}://${forwardedHost}` : null) ||
            `${req.nextUrl.protocol}//${req.nextUrl.host}`;
        const accessToken = await getAccessToken();

        const payload = {
            merchantOrderId,
            amount: Math.round(amount * 100), // convert ₹ to paisa
            expireAfter: 600,
            paymentFlow: {
                type: 'PG_CHECKOUT',
                merchantUrls: {
                    redirectUrl: `${baseUrl}/payment-result?orderId=${merchantOrderId}`,
                },
            },
        };

        const res = await fetch(PAY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `O-Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        console.log('[PhonePe initiate] HTTP', res.status, JSON.stringify(data, null, 2));

        if (!res.ok) {
            return NextResponse.json({ error: data }, { status: res.status });
        }

        return NextResponse.json({
            phonePeOrderId: data.orderId,
            redirectUrl: data.redirectUrl,
            state: data.state,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
