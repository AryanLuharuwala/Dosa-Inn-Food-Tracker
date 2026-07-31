import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { cancelCampaign } from '@/lib/marketing/db';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    await cancelCampaign(id);
    return NextResponse.json({ ok: true });
}
