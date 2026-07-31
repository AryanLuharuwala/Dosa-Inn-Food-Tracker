import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { getGroupMemberPhones, addGroupMember, removeGroupMember } from '@/lib/marketing/db';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    return NextResponse.json(await getGroupMemberPhones(id));
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const phone: unknown = body?.phone;
    if (typeof phone !== 'string' || !phone.trim()) return NextResponse.json({ error: 'phone required' }, { status: 400 });
    await addGroupMember(id, phone);
    return NextResponse.json({ ok: true });
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!await isAdminRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const phone = req.nextUrl.searchParams.get('phone');
    if (!phone) return NextResponse.json({ error: 'phone query param required' }, { status: 400 });
    await removeGroupMember(id, phone);
    return NextResponse.json({ ok: true });
}
