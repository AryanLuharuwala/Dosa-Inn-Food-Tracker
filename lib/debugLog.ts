/**
 * SQLite-backed log of order/WhatsApp abuse-guard decisions, surfaced in the
 * admin debug panel. Deliberately not an in-memory array — instrumentation.ts
 * (which starts the marketing scheduler) loads through a separate module
 * graph from regular API routes, so an in-memory store would silently split
 * into two instances that never see each other's writes. getDb() is a
 * process-wide singleton (globalThis-cached), so this is genuinely shared.
 */

import { getDb } from '@/lib/db';

export type DebugEvent = {
    id: string;
    timestamp: string;
    type: 'order_add' | 'whatsapp_send';
    phone?: string;
    ip?: string;
    allowed: boolean;
    reason: string;
};

const MAX_EVENTS = 200;

export function logDebugEvent(e: Omit<DebugEvent, 'id' | 'timestamp'>): void {
    const db = getDb();
    db.prepare('INSERT INTO debug_events (ts, type, phone, ip, allowed, reason) VALUES (?, ?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), e.type, e.phone ?? null, e.ip ?? null, e.allowed ? 1 : 0, e.reason);
    // Trim opportunistically so this never grows unbounded — cheap relative
    // to the insert itself, no separate cleanup job needed.
    db.prepare(`
        DELETE FROM debug_events WHERE id NOT IN (
            SELECT id FROM debug_events ORDER BY id DESC LIMIT ?
        )
    `).run(MAX_EVENTS);
}

export function getDebugEvents(): DebugEvent[] {
    const db = getDb();
    const rows = db.prepare('SELECT id, ts, type, phone, ip, allowed, reason FROM debug_events ORDER BY id DESC LIMIT ?').all(MAX_EVENTS) as {
        id: number; ts: string; type: DebugEvent['type']; phone: string | null; ip: string | null; allowed: number; reason: string;
    }[];
    return rows.map(r => ({
        id: String(r.id),
        timestamp: r.ts,
        type: r.type,
        phone: r.phone ?? undefined,
        ip: r.ip ?? undefined,
        allowed: !!r.allowed,
        reason: r.reason,
    }));
}
