import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/db';

export interface PrintDevice {
    id: string;
    token_hash: string;
    label: string;
    created_at: Date;
    last_seen_at: Date | null;
    revoked: boolean;
}

export interface PrintJob {
    id: string;
    device_id: string | null;    // set when claimed (inflight)
    payload: Buffer;
    width: number;
    height: number;
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
    };
    await db.collection<PrintDevice>('print_devices').insertOne(device);
    return { device, plainToken };
}

export async function revokeDevice(id: string): Promise<void> {
    const db = await getDb();
    await db.collection('print_devices').updateOne({ id }, { $set: { revoked: true } });
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function enqueuePrintJob(payload: Buffer, width: number, height: number): Promise<string> {
    const db = await getDb();
    const id = randomBytes(16).toString('hex');
    const job: PrintJob = {
        id,
        device_id: null,
        payload,
        width,
        height,
        status: 'queued',
        attempts: 0,
        visible_after: new Date(),
        created_at: new Date(),
    };
    await db.collection<PrintJob>('print_jobs').insertOne(job);
    return id;
}

/** Pop the next available job into inflight state. Returns null if queue empty. */
export async function claimNextJob(deviceId: string): Promise<PrintJob | null> {
    const db = await getDb();
    const now = new Date();
    const visibleAfter = new Date(now.getTime() + 60_000); // 60s visibility timeout

    // findOneAndUpdate is atomic — no double-delivery.
    // The $or also recovers stalled inflight jobs whose 60s visibility timeout
    // has expired (device crashed before acking).
    const result = await db.collection<PrintJob>('print_jobs').findOneAndUpdate(
        { $or: [
            { status: 'queued',   visible_after: { $lte: now } },
            { status: 'inflight', visible_after: { $lte: now }, attempts: { $lt: 3 } },
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
