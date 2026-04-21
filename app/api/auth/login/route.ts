import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_NAME = 'admin_session';
const COOKIE_VALUE = 'authenticated';

export async function POST(req: NextRequest) {
    const { password } = await req.json();

    if (password !== ADMIN_PASSWORD) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, COOKIE_VALUE, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
}
