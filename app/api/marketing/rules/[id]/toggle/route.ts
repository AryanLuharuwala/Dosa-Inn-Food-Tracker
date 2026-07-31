import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { setRuleEnabled } from '@/lib/marketing/db';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const enabled: unknown = body?.enabled;
    if (typeof enabled !== 'boolean') return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 });
    await setRuleEnabled(id, enabled);
    return NextResponse.json({ ok: true });
}
