import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';

const WA_SERVICE = `http://127.0.0.1:${process.env.WA_SERVICE_PORT || 3478}`;

async function waFetch(path: string, init?: RequestInit) {
    const res = await fetch(`${WA_SERVICE}${path}`, init);
    return res;
}

const ALLOWED_GET_ACTIONS = new Set(['status', 'qr', 'logs']);

// GET /api/whatsapp?action=status|qr|logs
export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const action = req.nextUrl.searchParams.get('action') ?? 'status';
    if (!ALLOWED_GET_ACTIONS.has(action)) {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    try {
        const res = await waFetch(`/${action}`);
        const data = await res.json();
        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ error: 'WhatsApp service unavailable' }, { status: 503 });
    }
}

// POST /api/whatsapp   body: { action: 'send'|'logout', to?, message? }
export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action } = body;

    try {
        if (action === 'send') {
            const res = await waFetch('/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: body.to, message: body.message }),
            });
            return NextResponse.json(await res.json(), { status: res.status });
        }

        if (action === 'logout') {
            const res = await waFetch('/logout', { method: 'POST' });
            return NextResponse.json(await res.json(), { status: res.status });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch {
        return NextResponse.json({ error: 'WhatsApp service unavailable' }, { status: 503 });
    }
}
