import { NextRequest, NextResponse } from 'next/server';
import { rateLimited, getClientIp } from '@/lib/apiAuth';
import { createSession } from '@/lib/adminSessions';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const COOKIE_NAME = 'admin_session';

export async function POST(req: NextRequest) {
    const ip = getClientIp(req);

    // 20 attempts per IP per 10 minutes.
    // Previous limit was 5 — too low for enterprise/university WiFi where all
    // restaurant devices share a single public IP. This caused everyone to be
    // locked out whenever a few devices tried to log in around the same time.
    if (await rateLimited(`login:${ip}`, 20, 10 * 60_000)) {
        return NextResponse.json({ error: 'Too many attempts. Try again in 10 minutes.' }, { status: 429 });
    }

    const { password } = await req.json();

    if (!password || password !== ADMIN_PASSWORD) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const ua = req.headers.get('user-agent') ?? 'unknown';
    const sessionToken = await createSession(ip, ua);

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
    });
    return res;
}
