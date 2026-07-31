import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { approveRegistration } from '@/lib/printer/espRegistration';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ euidHash: string }> },
) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { euidHash } = await params;
    const body = await req.json().catch(() => null);
    const label: unknown = body?.label;
    if (typeof label !== 'string' || !label.trim()) {
        return NextResponse.json({ error: 'label required' }, { status: 400 });
    }

    const result = await approveRegistration(euidHash, label.trim());
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
    return NextResponse.json({ ok: true });
}
