import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { scheduleCampaignNow } from '@/lib/marketing/db';

// "Send now" schedules for the current instant — the scheduler's next tick
// (within 60s) does the actual paced sending, so this request returns
// immediately instead of blocking for however long a large campaign takes.
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    await scheduleCampaignNow(id);
    return NextResponse.json({ ok: true });
}
