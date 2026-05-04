import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { revokeByShortId } from '@/lib/adminSessions';

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ shortId: string }> },
) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { shortId } = await params;
    await revokeByShortId(shortId);
    return NextResponse.json({ ok: true });
}
