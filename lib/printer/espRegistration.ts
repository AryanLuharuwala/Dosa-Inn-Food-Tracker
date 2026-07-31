import { createHmac } from 'crypto';
import { getDb } from '@/lib/db';
import { createDevice, rotateDeviceToken } from './printerDb';

const HASH_SECRET = process.env.EUID_HASH_SECRET || 'dev-only-euid-secret-change-me';
if (HASH_SECRET === 'dev-only-euid-secret-change-me') {
    console.warn('[espRegistration] EUID_HASH_SECRET is not set — using an insecure dev default. Set it in .env.local for production.');
}

/** The raw EUID (ESP32 WiFi MAC) is never stored — only this HMAC. */
export function hashEuid(euid: string): string {
    return createHmac('sha256', HASH_SECRET).update(euid.trim().toLowerCase()).digest('hex');
}

// One-time, in-memory pickup for a freshly-approved device's plaintext
// token — bridges the gap between the admin's Accept click and the ESP's
// next poll. Never written to disk, and deleted the moment it's delivered,
// same spirit as POST /api/print/devices ("returned exactly once").
const pendingTokens = new Map<string, string>();

interface RegistrationRow {
    euid_hash: string;
    status: 'pending' | 'approved';
    device_id: string | null;
    first_seen_at: string;
    last_seen_at: string;
    ip: string | null;
}

function insertPending(db: ReturnType<typeof getDb>, euidHash: string, ip: string, now: string) {
    db.prepare(
        'INSERT INTO esp_registrations (euid_hash, status, device_id, first_seen_at, last_seen_at, ip) VALUES (?, ?, NULL, ?, ?, ?)'
    ).run(euidHash, 'pending', now, now, ip);
}

export type RegisterResult = { status: 'pending' } | { status: 'approved'; token: string };

/** Called by the ESP itself (no auth — that's the point). Creates a pending
 *  request the first time a given hardware identity is seen, otherwise
 *  reports back its current state. */
export async function registerOrPoll(euid: string, ip: string): Promise<RegisterResult> {
    const db = getDb();
    const euidHash = hashEuid(euid);
    const now = new Date().toISOString();

    const row = db.prepare('SELECT * FROM esp_registrations WHERE euid_hash = ?').get(euidHash) as RegistrationRow | undefined;

    if (!row) {
        insertPending(db, euidHash, ip, now);
        return { status: 'pending' };
    }

    if (row.status === 'pending') {
        db.prepare('UPDATE esp_registrations SET last_seen_at = ?, ip = ? WHERE euid_hash = ?').run(now, ip, euidHash);
        return { status: 'pending' };
    }

    // status === 'approved'
    const device = db.prepare('SELECT revoked FROM print_devices WHERE id = ?').get(row.device_id) as { revoked: number } | undefined;
    if (!device || device.revoked) {
        // Deregistered — reset this EUID back to unknown, needs fresh approval.
        db.prepare('DELETE FROM esp_registrations WHERE euid_hash = ?').run(euidHash);
        insertPending(db, euidHash, ip, now);
        return { status: 'pending' };
    }

    db.prepare('UPDATE esp_registrations SET last_seen_at = ?, ip = ? WHERE euid_hash = ?').run(now, ip, euidHash);

    const waiting = pendingTokens.get(euidHash);
    if (waiting) {
        pendingTokens.delete(euidHash);
        return { status: 'approved', token: waiting };
    }

    // Already delivered once before — the ESP asking again means it lost
    // its token (NVS wipe, reflash). The EUID is already trusted, so
    // self-heal with a fresh token instead of requiring a new Accept click.
    const rotated = await rotateDeviceToken(row.device_id as string);
    if (!rotated) return { status: 'pending' }; // race: revoked between the checks above
    return { status: 'approved', token: rotated };
}

export interface PendingRegistration {
    euidHash: string;
    firstSeenAt: string;
    lastSeenAt: string;
    ip: string | null;
}

/** Admin-facing — caller must check isAdminRequest first. */
export function listPendingRegistrations(): PendingRegistration[] {
    const db = getDb();
    const rows = db.prepare(
        "SELECT euid_hash, first_seen_at, last_seen_at, ip FROM esp_registrations WHERE status = 'pending' ORDER BY first_seen_at DESC"
    ).all() as { euid_hash: string; first_seen_at: string; last_seen_at: string; ip: string | null }[];
    return rows.map(r => ({ euidHash: r.euid_hash, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, ip: r.ip }));
}

/** Admin-facing — caller must check isAdminRequest first. Idempotent:
 *  re-approving an already-approved request is a no-op success, so an
 *  accidental double-press of "Accept" can't create a second device or
 *  invalidate the token already handed out. */
export async function approveRegistration(euidHash: string, label: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM esp_registrations WHERE euid_hash = ?').get(euidHash) as RegistrationRow | undefined;
    if (!row) return { ok: false, reason: 'Unknown request — it may have already been reset (e.g. the device was revoked).' };
    if (row.status === 'approved') return { ok: true };

    const { device, plainToken } = await createDevice(label);
    db.prepare('UPDATE esp_registrations SET status = ?, device_id = ? WHERE euid_hash = ?').run('approved', device.id, euidHash);

    pendingTokens.set(euidHash, plainToken);
    // Safety net — if the ESP never picks it up, don't let the plaintext
    // linger in memory forever.
    setTimeout(() => pendingTokens.delete(euidHash), 30 * 60_000).unref();

    return { ok: true };
}
