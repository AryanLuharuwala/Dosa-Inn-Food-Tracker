import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import {
    listAutoReplyRules, createAutoReplyRule, setAutoReplyRuleEnabled, deleteAutoReplyRule,
    type MatchType, type ResponseType,
} from '@/lib/whatsappAutoReply';

// GET /api/whatsapp/auto-replies — list keyword -> reply rules
export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ rules: await listAutoReplyRules() });
}

// POST /api/whatsapp/auto-replies — create a rule
export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
        keyword?: string; matchType?: MatchType; responseType?: ResponseType;
        responseText?: string; responseImageUrl?: string;
    };
    if (!body.keyword?.trim() || !body.matchType || !body.responseType) {
        return NextResponse.json({ error: 'keyword, matchType and responseType are required' }, { status: 400 });
    }
    if (body.responseType === 'text' && !body.responseText?.trim()) {
        return NextResponse.json({ error: 'responseText is required for a text reply' }, { status: 400 });
    }

    const rule = await createAutoReplyRule({
        keyword: body.keyword,
        matchType: body.matchType,
        responseType: body.responseType,
        responseText: body.responseText,
        responseImageUrl: body.responseImageUrl,
    });
    return NextResponse.json({ rule });
}

// PATCH /api/whatsapp/auto-replies — toggle enabled
export async function PATCH(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, enabled } = await req.json() as { id?: string; enabled?: boolean };
    if (!id || typeof enabled !== 'boolean') return NextResponse.json({ error: 'id and enabled required' }, { status: 400 });
    await setAutoReplyRuleEnabled(id, enabled);
    return NextResponse.json({ ok: true });
}

// DELETE /api/whatsapp/auto-replies?id=...
export async function DELETE(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await deleteAutoReplyRule(id);
    return NextResponse.json({ ok: true });
}
