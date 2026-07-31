import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, rateLimited, getClientIp } from '@/lib/apiAuth';
import { registerOrPoll, listPendingRegistrations } from '@/lib/printer/espRegistration';

// POST — called by the ESP itself, no Bearer token (it doesn't have one
// yet). It polls this on a backoff whenever it has no working token; the
// response tells it whether an admin has approved it yet.
export async function POST(req: NextRequest) {
    const ip = getClientIp(req);
    if (await rateLimited(`esp-register:${ip}`, 10, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json().catch(() => null);
    const euid: unknown = body?.euid;
    if (typeof euid !== 'string' || !euid.trim()) {
        return NextResponse.json({ error: 'euid required' }, { status: 400 });
    }

    const result = await registerOrPoll(euid, ip);
    return NextResponse.json(result);
}

// GET — admin-facing list of pending self-registration requests.
export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(listPendingRegistrations());
}
