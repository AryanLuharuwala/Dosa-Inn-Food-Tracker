import { NextRequest, NextResponse } from 'next/server';
import { revokeByToken } from '@/lib/adminSessions';

export async function POST(req: NextRequest) {
    const token = req.cookies.get('admin_session')?.value ?? '';
    if (token) await revokeByToken(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set('admin_session', '', { maxAge: 0, path: '/' });
    return res;
}
