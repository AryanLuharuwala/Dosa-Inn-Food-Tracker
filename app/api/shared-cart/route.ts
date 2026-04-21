import { NextRequest, NextResponse } from 'next/server';
import {
    createSharedCart,
    getSharedCart,
    joinSharedCart,
    updateSharedCartParticipant,
} from '@/lib/localDb';
import type { SharedCartItem, SharedCartExtra } from '@/lib/localDb';
import { emit } from '@/lib/serverEvents';

// GET /api/shared-cart?code=ABC123
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });
    const cart = await getSharedCart(code.toUpperCase());
    if (!cart) return NextResponse.json({ error: 'Cart not found or expired' }, { status: 404 });
    return NextResponse.json(cart);
}

// POST /api/shared-cart
// actions: create | join | update
export async function POST(req: NextRequest) {
    const body = await req.json();
    const { action, visitorId } = body;

    if (!visitorId) return NextResponse.json({ error: 'visitorId required' }, { status: 400 });

    switch (action) {
        case 'create': {
            const { tableNumber, tokenNumber } = body as { tableNumber: string; tokenNumber: number };
            if (!tableNumber) return NextResponse.json({ error: 'tableNumber required' }, { status: 400 });
            const cart = await createSharedCart(tableNumber, tokenNumber, visitorId);
            emit(`shared-cart:${cart.code}`, 'participants');
            return NextResponse.json(cart);
        }

        case 'join': {
            const { code, mergeParticipants } = body as { code: string; mergeParticipants?: import('@/lib/localDb').SharedCartParticipant[] };
            if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 });
            const cart = await joinSharedCart(code.toUpperCase(), visitorId, mergeParticipants);
            if (!cart) return NextResponse.json({ error: 'Cart not found or expired' }, { status: 404 });
            emit(`shared-cart:${cart.code}`, 'participants');
            return NextResponse.json(cart);
        }

        case 'update': {
            const { code, items, extras } = body as {
                code: string;
                items: SharedCartItem[];
                extras: SharedCartExtra[];
            };
            const cart = await updateSharedCartParticipant(code.toUpperCase(), visitorId, items, extras);
            if (!cart) return NextResponse.json({ error: 'Cart not found or participant not in cart' }, { status: 404 });
            emit(`shared-cart:${code.toUpperCase()}`, 'participants');
            return NextResponse.json(cart);
        }

        default:
            return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
}
