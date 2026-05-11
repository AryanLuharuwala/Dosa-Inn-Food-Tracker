import { NextRequest, NextResponse } from 'next/server';

const IS_SANDBOX = process.env.CASHFREE_ENV !== 'production';

const LINKS_URL = IS_SANDBOX
    ? 'https://sandbox.cashfree.com/pg/links'
    : 'https://api.cashfree.com/pg/links';

const API_VERSION = '2023-08-01';

export async function POST(req: NextRequest) {
    try {
        const { merchantOrderId, amount, customerPhone, customerName } = await req.json() as {
            merchantOrderId: string;
            amount: number;
            customerPhone?: string;
            customerName?: string;
        };

        if (!merchantOrderId || !amount) {
            return NextResponse.json({ error: 'merchantOrderId and amount are required' }, { status: 400 });
        }

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

        // Expiry 10 minutes from now in IST (+05:30)
        const expiryDate = new Date(Date.now() + 10 * 60 * 1000);
        const expiryIst = new Date(expiryDate.getTime() + 5.5 * 60 * 60 * 1000);
        const pad = (n: number) => String(n).padStart(2, '0');
        const expiryStr = `${expiryIst.getUTCFullYear()}-${pad(expiryIst.getUTCMonth() + 1)}-${pad(expiryIst.getUTCDate())}T${pad(expiryIst.getUTCHours())}:${pad(expiryIst.getUTCMinutes())}:${pad(expiryIst.getUTCSeconds())}+05:30`;

        const payload = {
            link_id: merchantOrderId,
            link_amount: amount,
            link_currency: 'INR',
            link_purpose: 'Order Payment',
            customer_details: {
                customer_phone: customerPhone || '9999999999',
                customer_name: customerName || 'Customer',
                customer_email: 'orders@restaurant.com',
            },
            link_notify: { send_sms: false, send_email: false },
            link_auto_remind: false,
            link_expiry_time: expiryStr,
            link_meta: {
                return_url: `${baseUrl}/payment-result?orderId={link_id}`,
            },
        };

        const res = await fetch(LINKS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-client-id': process.env.CASHFREE_APP_ID!,
                'x-client-secret': process.env.CASHFREE_SECRET_KEY!,
                'x-api-version': API_VERSION,
            },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        console.log('[Cashfree initiate] HTTP', res.status, JSON.stringify(data, null, 2));

        if (!res.ok) {
            return NextResponse.json({ error: data }, { status: res.status });
        }

        return NextResponse.json({
            linkId: data.link_id,
            redirectUrl: data.link_url,
            status: data.link_status,
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
