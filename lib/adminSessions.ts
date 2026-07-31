import { randomBytes } from 'crypto';
import { getDb } from '@/lib/db';

export interface AdminSession {
    id: string;       // 64-char hex auth token (cookie value, never exposed to UI)
    shortId: string;  // 16-char hex revoke handle (safe to send to browser)
    ip: string;
    userAgent: string;
    createdAt: Date;
    lastSeenAt: Date;
}

export interface SessionView {
    shortId: string;
    ip: string;
    userAgent: string;
    createdAt: Date;
    lastSeenAt: Date;
    current: boolean;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(ip: string, userAgent: string): Promise<string> {
    const db = getDb();
    const id = randomBytes(32).toString('hex');
    const shortId = randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO admin_sessions (id, short_id, ip, user_agent, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, shortId, ip, userAgent, now, now);
    return id;
}

export async function validateAndTouch(token: string, ip: string): Promise<boolean> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    const db = getDb();
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    const res = db.prepare('UPDATE admin_sessions SET last_seen_at = ?, ip = ? WHERE id = ? AND created_at > ?')
        .run(new Date().toISOString(), ip, token, cutoff);
    return res.changes > 0;
}

export async function revokeByShortId(shortId: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM admin_sessions WHERE short_id = ?').run(shortId);
}

export async function revokeByToken(token: string): Promise<void> {
    const db = getDb();
    db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(token);
}

export async function revokeAllExcept(currentToken: string): Promise<number> {
    const db = getDb();
    const res = db.prepare('DELETE FROM admin_sessions WHERE id != ?').run(currentToken);
    return res.changes;
}

export async function listSessions(currentToken: string): Promise<SessionView[]> {
    const db = getDb();
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    const rows = db.prepare(
        'SELECT id, short_id, ip, user_agent, created_at, last_seen_at FROM admin_sessions WHERE created_at > ? ORDER BY last_seen_at DESC'
    ).all(cutoff) as { id: string; short_id: string; ip: string; user_agent: string; created_at: string; last_seen_at: string }[];
    return rows.map(s => ({
        shortId: s.short_id,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: new Date(s.created_at),
        lastSeenAt: new Date(s.last_seen_at),
        current: s.id === currentToken,
    }));
}
