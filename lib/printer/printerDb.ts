import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';

/** Per-device runtime tunables. Live-editable from /admin/print-devices and
 *  applied on the next print job. */
export interface DeviceSettings {
    /** Job filter — 'all' takes any job, 'kot'/'bill' only that kind. */
    role: 'all' | 'kot' | 'bill';
    /** Motor speed (0x01–0xFF). Lower = slower = darker. iPrint default 34. */
    speed: number;
    /** Heating energy 0–65535. Higher = darker. iPrint default 13500. */
    energy: number;
    /** New-order alert tone duration. `short` plays the chime once (~3s);
     *  `long` loops the chime until silenced by a button press. */
    ring: 'short' | 'long';
}

export const DEFAULT_SETTINGS: DeviceSettings = {
    role:   'all',
    speed:  34,
    energy: 13500,
    ring:   'short',
};

export interface PrintDevice {
    id: string;
    token_hash: string;
    label: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked: boolean;
    settings?: DeviceSettings;
}

export interface PrintJob {
    id: string;
    device_id: string | null;    // set when claimed (inflight)
    payload: Buffer;
    width: number;
    height: number;
    /** Optional — present for jobs created via /api/print/jobs with `kind`.
     *  Used for device-role filtering when claiming. */
    kind?: 'bill' | 'kot' | 'test' | 'stats';
    /** How many copies the device should print from this single fetch. The
     *  device prints `copies` times then acks once. Default 1 if missing. */
    copies?: number;
    status: 'queued' | 'inflight' | 'dead';
    attempts: number;
    visible_after: Date;
    created_at: Date;
}

interface DeviceRow {
    id: string; token_hash: string; label: string | null;
    created_at: string; last_seen_at: string | null; revoked: number; settings: string | null;
}

function rowToDevice(r: DeviceRow): PrintDevice {
    return {
        id: r.id,
        token_hash: r.token_hash,
        label: r.label ?? '',
        created_at: new Date(r.created_at),
        last_seen_at: r.last_seen_at ? new Date(r.last_seen_at) : null,
        revoked: !!r.revoked,
        settings: r.settings ? JSON.parse(r.settings) : undefined,
    };
}

// ── Devices ──────────────────────────────────────────────────────────────────

export async function listDevices(): Promise<PrintDevice[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM print_devices ORDER BY created_at DESC').all() as DeviceRow[];
    return rows.map(rowToDevice);
}

export async function findDeviceByRawToken(token: string): Promise<PrintDevice | null> {
    const db = getDb();
    // Brute-force compare is required for bcrypt — we can't query by hash directly.
    // In practice there are at most a handful of devices, so this is fine.
    const rows = db.prepare('SELECT * FROM print_devices WHERE revoked = 0').all() as DeviceRow[];
    for (const r of rows) {
        const d = rowToDevice(r);
        if (await bcrypt.compare(token, d.token_hash)) return d;
    }
    return null;
}

export async function updateDeviceLastSeen(id: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE print_devices SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id);
}

export async function createDevice(label: string): Promise<{ device: PrintDevice; plainToken: string }> {
    const db = getDb();
    const plainToken = randomBytes(32).toString('base64url');
    const token_hash = await bcrypt.hash(plainToken, 12);
    const id = randomBytes(8).toString('hex');
    const created_at = new Date().toISOString();
    const settings = { ...DEFAULT_SETTINGS };
    db.prepare('INSERT INTO print_devices (id, token_hash, label, created_at, last_seen_at, revoked, settings) VALUES (?, ?, ?, ?, NULL, 0, ?)')
        .run(id, token_hash, label, created_at, JSON.stringify(settings));
    const device: PrintDevice = {
        id, token_hash, label, created_at: new Date(created_at), last_seen_at: null, revoked: false, settings,
    };
    return { device, plainToken };
}

export async function revokeDevice(id: string): Promise<void> {
    const db = getDb();
    db.prepare('UPDATE print_devices SET revoked = 1 WHERE id = ?').run(id);
    // "Deregister the EUID" — a revoked device's hashed hardware identity
    // stops being auto-trusted; the next self-registration attempt from that
    // same ESP32 starts over as a fresh pending request.
    db.prepare('DELETE FROM esp_registrations WHERE device_id = ?').run(id);
}

/** Mint a fresh token for an already-approved device and overwrite its hash,
 *  implicitly invalidating whatever token it had before. Used when a known,
 *  trusted EUID re-registers because it lost its token (NVS wipe, reflash)
 *  — no admin button press needed, the EUID itself is the trust anchor. */
export async function rotateDeviceToken(id: string): Promise<string | null> {
    const db = getDb();
    const exists = db.prepare('SELECT 1 FROM print_devices WHERE id = ? AND revoked = 0').get(id);
    if (!exists) return null;
    const plainToken = randomBytes(32).toString('base64url');
    const token_hash = await bcrypt.hash(plainToken, 12);
    db.prepare('UPDATE print_devices SET token_hash = ? WHERE id = ?').run(token_hash, id);
    return plainToken;
}

export async function updateDeviceSettings(id: string, patch: Partial<DeviceSettings>): Promise<DeviceSettings | null> {
    const db = getDb();
    const row = db.prepare('SELECT settings FROM print_devices WHERE id = ?').get(id) as { settings: string | null } | undefined;
    if (!row) return null;
    const current = row.settings ? JSON.parse(row.settings) : {};
    const merged: DeviceSettings = { ...DEFAULT_SETTINGS, ...current, ...patch };
    // Clamp to valid ranges so a bad UI input can't brick a printer.
    merged.speed  = Math.max(1, Math.min(255, Math.floor(merged.speed)));
    merged.energy = Math.max(0, Math.min(65535, Math.floor(merged.energy)));
    if (!['all', 'kot', 'bill'].includes(merged.role)) merged.role = 'all';
    if (!['short', 'long'].includes(merged.ring)) merged.ring = 'short';
    db.prepare('UPDATE print_devices SET settings = ? WHERE id = ?').run(JSON.stringify(merged), id);
    return merged;
}

export async function getDeviceSettings(id: string): Promise<DeviceSettings> {
    const db = getDb();
    const row = db.prepare('SELECT settings FROM print_devices WHERE id = ?').get(id) as { settings: string | null } | undefined;
    return { ...DEFAULT_SETTINGS, ...(row?.settings ? JSON.parse(row.settings) : {}) };
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

/** Jobs older than this are skipped both in claimNextJob and listJobs.
 *  Guards against printing yesterday's tickets when the ESP comes back
 *  from a long outage. */
const JOB_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/** Job summary for the admin UI — same as PrintJob but without the bitmap
 *  payload (binary, large, never useful in the UI). */
export interface PrintJobSummary {
    id: string;
    device_id: string | null;
    width: number;
    height: number;
    status: 'queued' | 'inflight' | 'dead';
    attempts: number;
    visible_after: Date;
    created_at: Date;
}

interface JobRow {
    id: string; device_id: string | null; payload: Buffer; width: number; height: number;
    kind: string | null; copies: number; status: string; attempts: number;
    visible_after: string; created_at: string;
}

function rowToJob(r: JobRow): PrintJob {
    return {
        id: r.id,
        device_id: r.device_id,
        payload: r.payload,
        width: r.width,
        height: r.height,
        kind: (r.kind ?? undefined) as PrintJob['kind'],
        copies: r.copies,
        status: r.status as PrintJob['status'],
        attempts: r.attempts,
        visible_after: new Date(r.visible_after),
        created_at: new Date(r.created_at),
    };
}

function rowToJobSummary(r: Omit<JobRow, 'payload'>): PrintJobSummary {
    return {
        id: r.id,
        device_id: r.device_id,
        width: r.width,
        height: r.height,
        status: r.status as PrintJobSummary['status'],
        attempts: r.attempts,
        visible_after: new Date(r.visible_after),
        created_at: new Date(r.created_at),
    };
}

/** Shared rate-limiter key for deduping the auto-print-on-arrival KOT job.
 *  Order arrival can trigger an enqueue from two independent places (the
 *  server, unconditionally, and any open admin tab's own auto-print effect)
 *  — both call this with the same orderId so only the first one to reach the
 *  server actually creates a job; the other becomes a silent no-op backup
 *  instead of a duplicate ticket. Manual "Print KOT" clicks never use this
 *  key, so they're unaffected. */
export function autoKotDedupKey(orderId: string): string {
    return `auto-kot:${orderId}`;
}

export async function listJobs(): Promise<PrintJobSummary[]> {
    const db = getDb();
    const freshCutoff = new Date(Date.now() - JOB_MAX_AGE_MS).toISOString();
    const rows = db.prepare(
        'SELECT id, device_id, width, height, kind, copies, status, attempts, visible_after, created_at FROM print_jobs WHERE created_at >= ? ORDER BY created_at ASC'
    ).all(freshCutoff) as Omit<JobRow, 'payload'>[];
    return rows.map(rowToJobSummary);
}

export async function deleteJob(id: string): Promise<boolean> {
    const db = getDb();
    const res = db.prepare('DELETE FROM print_jobs WHERE id = ?').run(id);
    return res.changes > 0;
}

export async function enqueuePrintJob(
    payload: Buffer,
    width: number,
    height: number,
    kind?: PrintJob['kind'],
    copies: number = 1,
): Promise<string> {
    const db = getDb();
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    db.prepare(
        'INSERT INTO print_jobs (id, device_id, payload, width, height, kind, copies, status, attempts, visible_after, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(id, payload, width, height, kind ?? null, Math.max(1, Math.min(10, Math.floor(copies))), 'queued', now, now);
    return id;
}

/** Pop the next available job into inflight state. Filters by the calling
 *  device's `settings.role` — a 'kot' printer won't pick up bill jobs, etc.
 *  Also skips jobs older than JOB_MAX_AGE_MS (1 hr). Returns null if no
 *  eligible job is available. */
export async function claimNextJob(deviceId: string): Promise<PrintJob | null> {
    const db = getDb();
    const now = Date.now();
    const visibleAfter = new Date(now + 60_000).toISOString();
    const freshCutoff  = new Date(now - JOB_MAX_AGE_MS).toISOString();
    const nowIso = new Date(now).toISOString();

    const settings = await getDeviceSettings(deviceId);
    const kindClause = settings.role === 'all' ? '' : 'AND kind = ?';

    const sql = `
        SELECT id, device_id, payload, width, height, kind, copies, status, attempts, visible_after, created_at
        FROM print_jobs
        WHERE created_at >= ?
        ${kindClause}
        AND (
            (status = 'queued' AND visible_after <= ?)
            OR (status = 'inflight' AND visible_after <= ? AND attempts < 3)
        )
        ORDER BY created_at ASC
    `;
    const params: unknown[] = [freshCutoff];
    if (settings.role !== 'all') params.push(settings.role);
    params.push(nowIso, nowIso);

    const candidates = db.prepare(sql).all(...params) as JobRow[];

    for (const candidate of candidates) {
        // Atomic claim — only succeeds if no one else has changed its state
        // since we read it. Loop covers the race where another device claimed
        // the oldest before us.
        const res = db.prepare(
            'UPDATE print_jobs SET status = ?, device_id = ?, visible_after = ?, attempts = attempts + 1 WHERE id = ? AND status = ? AND attempts = ?'
        ).run('inflight', deviceId, visibleAfter, candidate.id, candidate.status, candidate.attempts);
        if (res.changes > 0) {
            const claimed = db.prepare(
                'SELECT id, device_id, payload, width, height, kind, copies, status, attempts, visible_after, created_at FROM print_jobs WHERE id = ?'
            ).get(candidate.id) as JobRow;
            return rowToJob(claimed);
        }
    }
    return null;
}

/** Acknowledge a job: delete on success, re-queue or dead on error. */
export async function ackJob(
    id: string,
    deviceId: string,
    status: 'ok' | 'error',
    errorMsg?: string,
): Promise<void> {
    const db = getDb();

    if (status === 'ok') {
        db.prepare('DELETE FROM print_jobs WHERE id = ? AND device_id = ?').run(id, deviceId);
        return;
    }

    const job = db.prepare('SELECT attempts FROM print_jobs WHERE id = ? AND device_id = ?').get(id, deviceId) as { attempts: number } | undefined;
    if (!job) return;

    if (job.attempts >= 3) {
        db.prepare('UPDATE print_jobs SET status = ? WHERE id = ?').run('dead', id);
    } else {
        // Return to queue; brief back-off so we don't thrash
        db.prepare('UPDATE print_jobs SET status = ?, device_id = NULL, visible_after = ? WHERE id = ?')
            .run('queued', new Date(Date.now() + 5_000).toISOString(), id);
    }

    console.warn(`[print-jobs] ack error id=${id} attempts=${job.attempts} err=${errorMsg}`);
}
