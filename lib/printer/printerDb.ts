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
}

export const DEFAULT_SETTINGS: DeviceSettings = {
    role:   'all',
    speed:  34,
    energy: 13500,
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
    status: 'queued' | 'inflight' | 'dead';
    attempts: number;
    visible_after: Date;
    created_at: Date;
}

// ── Devices ──────────────────────────────────────────────────────────────────

export async function listDevices(): Promise<PrintDevice[]> {
    const db = await getDb();
    return db.collection<PrintDevice>('print_devices').find({}).sort({ created_at: -1 }).toArray();
}

export async function findDeviceByRawToken(token: string): Promise<PrintDevice | null> {
    const db = await getDb();
    // Brute-force compare is required for bcrypt — we can't query by hash directly.
    // In practice there are at most a handful of devices, so this is fine.
    const devices = await db.collection<PrintDevice>('print_devices')
        .find({ revoked: false })
        .toArray();
    for (const d of devices) {
        if (await bcrypt.compare(token, d.token_hash)) return d;
    }
    return null;
}

export async function updateDeviceLastSeen(id: string): Promise<void> {
    const db = await getDb();
    await db.collection('print_devices').updateOne(
        { id },
        { $set: { last_seen_at: new Date() } },
    );
}

export async function createDevice(label: string): Promise<{ device: PrintDevice; plainToken: string }> {
    const db = await getDb();
    const plainToken = randomBytes(32).toString('base64url');
    const token_hash = await bcrypt.hash(plainToken, 12);
    const device: PrintDevice = {
        id: randomBytes(8).toString('hex'),
        token_hash,
        label,
        created_at: new Date(),
        last_seen_at: null,
        revoked: false,
        settings: { ...DEFAULT_SETTINGS },
    };
    await db.collection<PrintDevice>('print_devices').insertOne(device);
    return { device, plainToken };
}

export async function revokeDevice(id: string): Promise<void> {
    const db = await getDb();
    await db.collection('print_devices').updateOne({ id }, { $set: { revoked: true } });
}

export async function updateDeviceSettings(id: string, patch: Partial<DeviceSettings>): Promise<DeviceSettings | null> {
    const db = await getDb();
    const dev = await db.collection<PrintDevice>('print_devices').findOne({ id });
    if (!dev) return null;
    const merged: DeviceSettings = { ...DEFAULT_SETTINGS, ...(dev.settings ?? {}), ...patch };
    // Clamp to valid ranges so a bad UI input can't brick a printer.
    merged.speed  = Math.max(1, Math.min(255, Math.floor(merged.speed)));
    merged.energy = Math.max(0, Math.min(65535, Math.floor(merged.energy)));
    if (!['all', 'kot', 'bill'].includes(merged.role)) merged.role = 'all';
    await db.collection('print_devices').updateOne({ id }, { $set: { settings: merged } });
    return merged;
}

export async function getDeviceSettings(id: string): Promise<DeviceSettings> {
    const db = await getDb();
    const dev = await db.collection<PrintDevice>('print_devices').findOne({ id });
    return { ...DEFAULT_SETTINGS, ...(dev?.settings ?? {}) };
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

export async function listJobs(): Promise<PrintJobSummary[]> {
    const db = await getDb();
    const freshCutoff = new Date(Date.now() - JOB_MAX_AGE_MS);
    return db.collection<PrintJob>('print_jobs')
        .find(
            { created_at: { $gte: freshCutoff } },     // hide stale jobs
            { projection: { payload: 0 } } as { projection: Record<string, 0 | 1> },
        )
        .sort({ created_at: 1 })
        .toArray() as unknown as PrintJobSummary[];
}

export async function deleteJob(id: string): Promise<boolean> {
    const db = await getDb();
    const res = await db.collection<PrintJob>('print_jobs').deleteOne({ id });
    return res.deletedCount > 0;
}

export async function enqueuePrintJob(
    payload: Buffer,
    width: number,
    height: number,
    kind?: PrintJob['kind'],
): Promise<string> {
    const db = await getDb();
    const id = randomBytes(16).toString('hex');
    const job: PrintJob = {
        id,
        device_id: null,
        payload,
        width,
        height,
        kind,
        status: 'queued',
        attempts: 0,
        visible_after: new Date(),
        created_at: new Date(),
    };
    await db.collection<PrintJob>('print_jobs').insertOne(job);
    return id;
}

/** Pop the next available job into inflight state. Filters by the calling
 *  device's `settings.role` — a 'kot' printer won't pick up bill jobs, etc.
 *  Also skips jobs older than JOB_MAX_AGE_MS (1 hr). Returns null if no
 *  eligible job is available. */
export async function claimNextJob(deviceId: string): Promise<PrintJob | null> {
    const db = await getDb();
    const now = new Date();
    const visibleAfter = new Date(now.getTime() + 60_000);
    const freshCutoff  = new Date(now.getTime() - JOB_MAX_AGE_MS);

    const settings = await getDeviceSettings(deviceId);
    const kindFilter =
        settings.role === 'all' ? {} :
        { kind: settings.role };

    const result = await db.collection<PrintJob>('print_jobs').findOneAndUpdate(
        { $and: [
            kindFilter,
            { created_at: { $gte: freshCutoff } }, // skip stale jobs
            { $or: [
                { status: 'queued',   visible_after: { $lte: now } },
                { status: 'inflight', visible_after: { $lte: now }, attempts: { $lt: 3 } },
            ] },
        ] },
        {
            $set: {
                status: 'inflight',
                device_id: deviceId,
                visible_after: visibleAfter,
            },
            $inc: { attempts: 1 },
        },
        { sort: { created_at: 1 }, returnDocument: 'after' },
    );
    return result ?? null;
}

/** Acknowledge a job: delete on success, re-queue or dead on error. */
export async function ackJob(
    id: string,
    deviceId: string,
    status: 'ok' | 'error',
    errorMsg?: string,
): Promise<void> {
    const db = await getDb();
    const col = db.collection<PrintJob>('print_jobs');

    if (status === 'ok') {
        await col.deleteOne({ id, device_id: deviceId });
        return;
    }

    const job = await col.findOne({ id, device_id: deviceId });
    if (!job) return;

    if (job.attempts >= 3) {
        await col.updateOne({ id }, { $set: { status: 'dead' } });
    } else {
        // Return to queue; brief back-off so we don't thrash
        await col.updateOne({ id }, {
            $set: {
                status: 'queued',
                device_id: null,
                visible_after: new Date(Date.now() + 5_000),
            },
        });
    }

    console.warn(`[print-jobs] ack error id=${id} attempts=${job.attempts} err=${errorMsg}`);
}
