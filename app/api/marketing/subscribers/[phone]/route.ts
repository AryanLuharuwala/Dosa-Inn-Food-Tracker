import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { removeSubscriber, unsubscribe } from '@/lib/marketing/db';

// DELETE — hard remove. Use ?soft=1 to instead mark opted-out (kept for
// record-keeping but excluded from future sends).
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ phone: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { phone } = await params;
    if (req.nextUrl.searchParams.get('soft') === '1') {
        await unsubscribe(phone);
    } else {
        await removeSubscriber(phone);
    }
    return NextResponse.json({ ok: true });
}
