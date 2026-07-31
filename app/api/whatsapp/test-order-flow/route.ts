import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, autoReplyAllowedForPhone } from '@/lib/apiAuth';
import { getSettings } from '@/lib/localDb';
import { startOrderFlow } from '@/lib/whatsappPollScheduler';

// POST /api/whatsapp/test-order-flow   body: { to }
// Manually kicks off the exact same poll-ordering conversation a real
// trigger-word message would — gated by the same mode/DEBUG_TEST_PHONES
// rules as a real inbound message, so 'off' really means nothing sends,
// even from this button.
export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { to } = await req.json() as { to?: string };
    if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 });
    const digits = to.replace(/\D/g, '');

    const settings = await getSettings();
    if (!autoReplyAllowedForPhone(settings.whatsappAutoReplyMode, digits)) {
        return NextResponse.json({ error: 'Blocked by the current auto-reply mode, or not a registered test number.' }, { status: 403 });
    }

    await startOrderFlow(digits);
    return NextResponse.json({ ok: true });
}
