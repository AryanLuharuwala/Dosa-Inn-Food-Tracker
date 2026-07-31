import { NextRequest, NextResponse } from 'next/server';
import { autoReplyAllowedForPhone } from '@/lib/apiAuth';
import { getSettings } from '@/lib/localDb';
import { listEnabledAutoReplyRules, matchAutoReplyRule } from '@/lib/whatsappAutoReply';
import { recordVote } from '@/lib/whatsappConversation';
import { startOrderFlow } from '@/lib/whatsappPollScheduler';
import { sendWhatsApp } from '@/lib/whatsapp';

// POST /api/whatsapp/inbound — webhook whatsapp-service calls for every
// inbound text message and decoded poll vote. Never logs anything for a
// rejected/ignored message (mode=off, mode=test_only for a non-registered
// number, a non-matching keyword) — the whole point of the debug toggle is
// that "off" produces zero trace.
export async function POST(req: NextRequest) {
    const token = process.env.BOT_API_TOKEN;
    if (!token) return NextResponse.json({ error: 'Not configured' }, { status: 503 });
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${token}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null) as
        | { type: 'text'; from: string; text: string }
        | { type: 'poll_vote'; from: string; pollId: string; selectedOptionTexts: string[] }
        | null;
    if (!body || typeof body.from !== 'string') return NextResponse.json({ ok: true });

    const digits = body.from.replace(/\D/g, '');
    if (!digits) return NextResponse.json({ ok: true });

    const settings = await getSettings();
    if (!autoReplyAllowedForPhone(settings.whatsappAutoReplyMode, digits)) return NextResponse.json({ ok: true });

    if (body.type === 'poll_vote') {
        if (!body.pollId) return NextResponse.json({ ok: true });
        await recordVote(body.pollId, body.selectedOptionTexts ?? []);
        return NextResponse.json({ ok: true });
    }

    if (body.type === 'text') {
        const rules = await listEnabledAutoReplyRules();
        const match = matchAutoReplyRule(rules, body.text ?? '');
        if (!match) return NextResponse.json({ ok: true }); // no match -> silently discarded, no reply, no log

        if (match.responseType === 'start_order_flow') {
            await startOrderFlow(digits);
        } else if (match.responseText) {
            await sendWhatsApp(digits, match.responseText, 'auto_reply', match.responseImageUrl ?? undefined);
        }
        return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
}
