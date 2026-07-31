import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { listCampaigns, createCampaign } from '@/lib/marketing/db';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json(await listCampaigns());
}

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => null);
    const name: unknown = body?.name;
    const message: unknown = body?.message;
    if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (typeof message !== 'string' || !message.trim()) return NextResponse.json({ error: 'message required' }, { status: 400 });

    const campaign = await createCampaign({
        name: name.trim(),
        message: message.trim(),
        imageUrl: typeof body.imageUrl === 'string' && body.imageUrl ? body.imageUrl : undefined,
        linkUrl: typeof body.linkUrl === 'string' && body.linkUrl ? body.linkUrl : undefined,
        targetGroupId: typeof body.targetGroupId === 'string' && body.targetGroupId ? body.targetGroupId : undefined,
        scheduledAt: typeof body.scheduledAt === 'string' && body.scheduledAt ? body.scheduledAt : undefined,
    });
    return NextResponse.json(campaign);
}
