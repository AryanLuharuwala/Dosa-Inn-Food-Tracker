'use client';

import { useEffect, useCallback, useRef } from 'react';
import { CartItem, CartExtra } from './cartContext';

const SHARED_CODE_KEY = 'shared_cart_code';

export function getStoredSharedCode(): string | null {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(SHARED_CODE_KEY);
}

export function setStoredSharedCode(code: string | null) {
    if (typeof window === 'undefined') return;
    if (code) sessionStorage.setItem(SHARED_CODE_KEY, code);
    else sessionStorage.removeItem(SHARED_CODE_KEY);
}

export interface SharedCart {
    code: string;
    tableNumber: string;
    tokenNumber: number;
    createdAt: string;
    expiresAt: string;
    participants: Array<{
        visitorId: string;
        joinedAt: string;
        items: CartItem[];
        extras: CartExtra[];
    }>;
}

// Push local cart changes to the shared cart server
export async function pushCartUpdate(
    code: string,
    visitorId: string,
    items: CartItem[],
    extras: CartExtra[]
): Promise<void> {
    try {
        await fetch('/api/shared-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', code, visitorId, items, extras }),
        });
    } catch { /* silent */ }
}

// Pull latest shared cart state
export async function fetchSharedCart(code: string): Promise<SharedCart | null> {
    try {
        const res = await fetch(`/api/shared-cart?code=${code}`);
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

// Hook: auto-push local cart changes + SSE-driven remote updates
export function useSharedCartSync(
    code: string | null,
    visitorId: string | null,
    items: CartItem[],
    extras: CartExtra[],
    onRemoteUpdate: (cart: SharedCart) => void
) {
    const lastPushRef = useRef<string>('');
    const onRemoteUpdateRef = useRef(onRemoteUpdate);
    onRemoteUpdateRef.current = onRemoteUpdate;

    // Push when local cart changes
    useEffect(() => {
        if (!code || !visitorId) return;
        const payload = JSON.stringify({ items, extras });
        if (payload === lastPushRef.current) return;
        lastPushRef.current = payload;
        pushCartUpdate(code, visitorId, items, extras);
    }, [code, visitorId, items, extras]);

    // SSE listener for remote changes
    useEffect(() => {
        if (!code) return;

        let es: EventSource;
        let retryTimeout: ReturnType<typeof setTimeout>;

        const connect = () => {
            es = new EventSource(`/api/events?channel=shared-cart:${code}`);
            es.addEventListener('change', async () => {
                const cart = await fetchSharedCart(code);
                if (cart) onRemoteUpdateRef.current(cart);
            });
            es.addEventListener('error', () => {
                es.close();
                retryTimeout = setTimeout(connect, 3000);
            });
        };
        connect();

        return () => {
            es?.close();
            clearTimeout(retryTimeout);
        };
    }, [code]);
}
