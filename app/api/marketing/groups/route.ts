import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listGroups, createGroup } from '@/lib/marketing/db';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await listGroups());
}

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const name: unknown = body?.name;
    if (typeof name !== 'string' || !name.trim()) {
        return NextResponse.json({ error: 'name required' }, { status: 400 });
    }
    return NextResponse.json(await createGroup(name.trim()));
}
