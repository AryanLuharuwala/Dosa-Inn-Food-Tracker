import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listDevices, createDevice } from '@/lib/printer/printerDb';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const devices = await listDevices();
    // Never expose token_hash
    return NextResponse.json(devices.map(({ token_hash: _, ...d }) => d));
}

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    const label: unknown = body?.label;
    if (typeof label !== 'string' || !label.trim()) {
        return NextResponse.json({ error: 'label required' }, { status: 400 });
    }
    const { plainToken } = await createDevice(label.trim());
    // Return the plain token exactly once — not stored anywhere after this response
    return NextResponse.json({ ok: true, token: plainToken });
}
