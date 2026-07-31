import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, debugTestPhones } from '@/lib/apiAuth';
import { getDebugEvents, logDebugEvent } from '@/lib/debugLog';
import { sendWhatsApp } from '@/lib/whatsapp';

// GET /api/debug — recent order/WhatsApp abuse-guard decisions
export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json({
        events: getDebugEvents(),
        personalNumbers: Array.from(debugTestPhones()),
    });
}

// POST /api/debug   body: { action: 'test_send', to, message }
// Only ever sends to numbers registered in DEBUG_TEST_PHONES — this is a
// pipeline test tool, not a general send endpoint, so it can never be used
// (even by an admin, even by accident) to message a real customer/stranger.
export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    if (body.action !== 'test_send') {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const { to, message } = body as { to?: string; message?: string };
    if (!to || !message) return NextResponse.json({ error: 'to and message required' }, { status: 400 });

    const allowed = debugTestPhones();
    if (!allowed.size) {
        return NextResponse.json({ error: 'No personal test numbers registered yet — add your own number below first.' }, { status: 400 });
    }

    const digits = to.replace(/\D/g, '');
    if (!allowed.has(digits)) {
        logDebugEvent({ type: 'whatsapp_send', phone: digits, allowed: false, reason: 'debug_test: blocked — not a registered personal number' });
        return NextResponse.json({ error: 'Test sends only go to your registered personal number(s).' }, { status: 403 });
    }

    await sendWhatsApp(to, message, 'debug_test');
    return NextResponse.json({ ok: true });
}
