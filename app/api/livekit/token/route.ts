import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';

export async function GET(req: NextRequest) {
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const room = req.nextUrl.searchParams.get('room') || 'rocky-da-adda-main';
    const username = req.nextUrl.searchParams.get('username') || `guest-${Math.random().toString(36).substring(7)}`;
    const role = req.nextUrl.searchParams.get('role') || 'customer';

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
        return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const at = new AccessToken(apiKey, apiSecret, {
        identity: username,
        name: username,
    });

    at.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
    });

    return NextResponse.json({ token: await at.toJwt() });
}
