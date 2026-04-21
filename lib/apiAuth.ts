/**
 * Server-side auth helpers for API routes.
 * - isAdminRequest: checks admin_session cookie
 * - isValidVisitor: checks visitor_id cookie (loose — prevents blank requests)
 * - rateLimiter: in-memory sliding-window, keyed by IP
 */

import { NextRequest } from 'next/server';

export function isAdminRequest(req: NextRequest): boolean {
    return req.cookies.get('admin_session')?.value === 'authenticated';
}

export function getVisitorId(req: NextRequest): string | null {
    return req.cookies.get('visitor_id')?.value ?? null;
}

// ── Simple in-memory rate limiter ─────────────────────────────────────────────

interface Window { count: number; start: number }
const windows = new Map<string, Window>();

/**
 * Returns true if the request should be BLOCKED.
 * @param key     Unique key (e.g. `login:${ip}`)
 * @param limit   Max requests
 * @param windowMs Time window in ms
 */
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const w = windows.get(key);
    if (!w || now - w.start > windowMs) {
        windows.set(key, { count: 1, start: now });
        return false;
    }
    w.count++;
    if (w.count > limit) return true;
    return false;
}

export function getClientIp(req: NextRequest): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
        req.headers.get('x-real-ip') ||
        'unknown'
    );
}
