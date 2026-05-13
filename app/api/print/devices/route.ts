import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listDevices, createDevice } from '@/lib/printer/printerDb';

export async function GET(req: NextRequest) {
    try {
        if (!await isAdminRequest(req)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const devices = await listDevices();
        // Never expose token_hash. JSON-stringify cycle drops non-serializable
        // Mongo types (ObjectId, Date) so a single bad doc can't 500 the route.
        const sanitized = devices.map(({ token_hash: _, ...d }) => {
            try { return JSON.parse(JSON.stringify(d)); }
            catch { return { id: d.id }; }
        });
        return NextResponse.json(sanitized);
    } catch (e) {
        console.error('[GET /api/print/devices]', (e as Error).message);
        return NextResponse.json({ error: 'Internal' }, { status: 500 });
    }
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
