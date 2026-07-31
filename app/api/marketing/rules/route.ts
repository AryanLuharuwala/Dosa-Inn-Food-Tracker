import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listRules, createRule, countFired, type TriggerKind } from '@/lib/marketing/db';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const rules = await listRules();
    const withCounts = await Promise.all(rules.map(async r => ({ ...r, firedCount: await countFired(r.id) })));
    return NextResponse.json(withCounts);
}

const VALID_KINDS: TriggerKind[] = ['order_ready_uncollected', 'customer_inactive'];

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const name: unknown = body?.name;
    const triggerKind: unknown = body?.triggerKind;
    const campaignId: unknown = body?.campaignId;
    const triggerParams: unknown = body?.triggerParams;

    if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (typeof triggerKind !== 'string' || !VALID_KINDS.includes(triggerKind as TriggerKind)) {
        return NextResponse.json({ error: 'invalid triggerKind' }, { status: 400 });
    }
    if (typeof campaignId !== 'string' || !campaignId) return NextResponse.json({ error: 'campaignId required' }, { status: 400 });
    if (typeof triggerParams !== 'object' || !triggerParams) return NextResponse.json({ error: 'triggerParams required' }, { status: 400 });

    const rule = await createRule({
        name: name.trim(),
        triggerKind: triggerKind as TriggerKind,
        triggerParams: triggerParams as Record<string, number>,
        campaignId,
    });
    return NextResponse.json(rule);
}
