import type { NextRequest } from 'next/server';
import { validateAndTouch } from '@/lib/adminSessions';

export async function isAdminRequest(req: NextRequest): Promise<boolean> {
    const token = req.cookies.get('admin_session')?.value ?? '';
    if (!token) return false;
    return validateAndTouch(token, getClientIp(req));
}

export function getVisitorId(req: NextRequest): string | null {
    return req.cookies.get('visitor_id')?.value ?? null;
}

export function getClientIp(req: NextRequest): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        req.headers.get('x-real-ip') ||
        'unknown'
    );
}

/** Admin-registered personal numbers used to gate every debug/test-only
 *  surface (test WhatsApp sends, 'test_only' auto-reply mode) — shared here
 *  so the set of numbers can't drift between call sites. */
export function debugTestPhones(): Set<string> {
    return new Set(
        (process.env.DEBUG_TEST_PHONES ?? '')
            .split(',')
            .map(s => s.replace(/\D/g, ''))
            .filter(Boolean)
    );
}

/** Shared gate for the WhatsApp inbound/auto-reply flow: 'off' never
 *  proceeds, 'test_only' only proceeds for a registered personal number,
 *  'live' proceeds for anyone. Used by both the real inbound webhook and
 *  the admin "test order flow now" button, so a mode change applies consistently. */
export function autoReplyAllowedForPhone(mode: 'off' | 'test_only' | 'live' | undefined, digits: string): boolean {
    if (mode === 'live') return true;
    if (mode === 'test_only') return debugTestPhones().has(digits);
    return false; // 'off' or undefined
}

// In-memory fixed-window rate limiter (single-instance; adequate for Azure Web App)
const windows = new Map<string, { count: number; resetAt: number }>();

export async function rateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const win = windows.get(key);

    if (!win || now > win.resetAt) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return false;
    }

    win.count++;
    return win.count > limit;
}
