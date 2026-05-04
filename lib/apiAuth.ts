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
