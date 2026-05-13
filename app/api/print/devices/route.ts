import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listDevices, createDevice } from '@/lib/printer/printerDb';

export async function GET(req: NextRequest) {
    try {
        if (!await isAdminRequest(req)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const devices = await listDevices();
        // Never expose token_hash. Convert any non-serializable Mongo types
        // (ObjectId, Date) by going through JSON.parse(JSON.stringify(...))
        // so a single bad doc can't 500 the whole endpoint.
        const sanitized = devices.map(({ token_hash: _, ...d }) => {
            try {
                return JSON.parse(JSON.stringify(d));
            } catch (e) {
                return { id: d.id, _serializationError: (e as Error).message };
            }
        });
        return NextResponse.json(sanitized);
    } catch (e) {
        const err = e as Error;
        console.error('[GET /api/print/devices] threw:', err);
        return NextResponse.json({
            error: 'Internal',
            message: err.message,
            stack: err.stack?.split('\n').slice(0, 5).join('\n'),
        }, { status: 500 });
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
