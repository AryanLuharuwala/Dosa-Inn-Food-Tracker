import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listSubscribers, subscribe } from '@/lib/marketing/db';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await listSubscribers());
}

// Admin manual add — distinct from the public /api/marketing/subscribe opt-in.
export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const phone: unknown = body?.phone;
    const name: unknown = body?.name;
    if (typeof phone !== 'string' || phone.replace(/\D/g, '').length < 10) {
        return NextResponse.json({ error: 'Valid phone required' }, { status: 400 });
    }
    await subscribe(phone, typeof name === 'string' ? name : undefined, 'admin_added');
    return NextResponse.json({ ok: true });
}
