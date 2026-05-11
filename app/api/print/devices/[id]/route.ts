import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { updateDeviceSettings, getDeviceSettings, type DeviceSettings } from '@/lib/printer/printerDb';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const settings = await getDeviceSettings(id);
    return NextResponse.json({ id, settings });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json().catch(() => null) as Partial<DeviceSettings> | null;
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
    }
    const updated = await updateDeviceSettings(id, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, settings: updated });
}
