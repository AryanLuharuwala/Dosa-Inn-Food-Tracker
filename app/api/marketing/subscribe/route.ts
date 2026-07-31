import { NextRequest, NextResponse } from 'next/server';
import { rateLimited, getClientIp } from '@/lib/apiAuth';
import { subscribe } from '@/lib/marketing/db';

// Public opt-in endpoint — a customer ticking "send me offers" at checkout.
// No admin auth (that's the point), rate-limited like every other public
// write this session.
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    if (await rateLimited(`marketing-subscribe:${ip}`, 10, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const phone: unknown = body?.phone;
    const name: unknown = body?.name;
    if (typeof phone !== 'string' || phone.replace(/\D/g, '').length < 10) {
        return NextResponse.json({ error: 'Valid phone required' }, { status: 400 });
    }

    await subscribe(phone, typeof name === 'string' ? name : undefined, 'checkout_optin');
    return NextResponse.json({ ok: true });
}
