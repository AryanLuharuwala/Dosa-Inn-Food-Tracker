import { NextRequest, NextResponse } from 'next/server';
import { requireDeviceToken, deviceRateLimited } from '@/lib/printer/auth';
import { ackJob } from '@/lib/printer/printerDb';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const auth = await requireDeviceToken(req);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await deviceRateLimited(auth.deviceId, 'ack')) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const status: unknown = body?.status;
    if (status !== 'ok' && status !== 'error') {
        return NextResponse.json({ error: 'status must be "ok" or "error"' }, { status: 400 });
    }

    await ackJob(id, auth.deviceId, status, body?.error);
    return NextResponse.json({ ok: true });
}
