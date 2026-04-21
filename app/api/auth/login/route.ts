import { NextRequest, NextResponse } from 'next/server';
import { rateLimited, getClientIp } from '@/lib/apiAuth';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_NAME = 'admin_session';
const COOKIE_VALUE = 'authenticated';

export async function POST(req: NextRequest) {
    const ip = getClientIp(req);

    // 5 attempts per IP per 10 minutes — blocks brute force
    if (await rateLimited(`login:${ip}`, 5, 10 * 60_000)) {
        return NextResponse.json({ error: 'Too many attempts. Try again in 10 minutes.' }, { status: 429 });
    }

    const { password } = await req.json();

    if (!password || password !== ADMIN_PASSWORD) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, COOKIE_VALUE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
    });
    return res;
}
