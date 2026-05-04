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

const COL = 'admin_sessions';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(ip: string, userAgent: string): Promise<string> {
    const db = await getDb();
    const id = randomBytes(32).toString('hex');
    const shortId = randomBytes(8).toString('hex');
    const now = new Date();
    await db.collection<AdminSession>(COL).insertOne({ id, shortId, ip, userAgent, createdAt: now, lastSeenAt: now });
    return id;
}

export async function validateAndTouch(token: string, ip: string): Promise<boolean> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
    const db = await getDb();
    const result = await db.collection<AdminSession>(COL).findOneAndUpdate(
        { id: token, createdAt: { $gt: new Date(Date.now() - TTL_MS) } },
        { $set: { lastSeenAt: new Date(), ip } },
    );
    return result !== null;
}

export async function revokeByShortId(shortId: string): Promise<void> {
    const db = await getDb();
    await db.collection(COL).deleteOne({ shortId });
}

export async function revokeByToken(token: string): Promise<void> {
    const db = await getDb();
    await db.collection(COL).deleteOne({ id: token });
}

export async function revokeAllExcept(currentToken: string): Promise<number> {
    const db = await getDb();
    const r = await db.collection(COL).deleteMany({ id: { $ne: currentToken } });
    return r.deletedCount;
}

export async function listSessions(currentToken: string): Promise<SessionView[]> {
    const db = await getDb();
    const rows = await db.collection<AdminSession>(COL)
        .find({ createdAt: { $gt: new Date(Date.now() - TTL_MS) } })
        .sort({ lastSeenAt: -1 })
        .toArray();
    return rows.map(s => ({
        shortId: s.shortId,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === currentToken,
    }));
}
