/**
 * Server-side auth helpers for API routes.
 * - isAdminRequest: checks admin_session cookie
 * - rateLimited: Redis sliding-window, works across all Azure instances
 */

import { NextRequest } from 'next/server';
import { getRedis } from './db';

export function isAdminRequest(req: NextRequest): boolean {
    return req.cookies.get('admin_session')?.value === 'authenticated';
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

/**
 * Returns true if the request should be BLOCKED (rate limit exceeded).
 * Uses Redis INCR + EXPIRE for a fixed-window counter that works across instances.
 *
 * Falls back to allowing the request if Redis is unavailable (fail-open),
 * so a Redis outage doesn't take the whole app down.
 */
export async function rateLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
        const redis = getRedis();
        const redisKey = `rl:${key}`;
        const count = await redis.incr(redisKey);
        if (count === 1) {
            // First hit — set TTL
            await redis.expire(redisKey, Math.ceil(windowMs / 1000));
        }
        return count > limit;
    } catch (e) {
        console.error('[rateLimited] Redis error — failing open:', (e as Error).message);
        return false; // fail-open: better to allow than to block everyone on Redis outage
    }
}
