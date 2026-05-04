import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listSessions, revokeAllExcept } from '@/lib/adminSessions';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const currentToken = req.cookies.get('admin_session')?.value ?? '';
    const sessions = await listSessions(currentToken);
    return NextResponse.json(sessions);
}

// DELETE — revoke every session except the caller's own
export async function DELETE(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const currentToken = req.cookies.get('admin_session')?.value ?? '';
    const revoked = await revokeAllExcept(currentToken);
    return NextResponse.json({ ok: true, revoked });
}
