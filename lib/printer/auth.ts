import type { NextRequest } from 'next/server';
import { findDeviceByRawToken, updateDeviceLastSeen } from './printerDb';
import { rateLimited } from '@/lib/apiAuth';

/** Validate the Bearer token, update last_seen_at, and return the device id.
 *  Returns null if auth fails (caller should respond 401). */
export async function requireDeviceToken(req: NextRequest): Promise<{ deviceId: string } | null> {
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;

    const device = await findDeviceByRawToken(token);
    if (!device) return null;

    await updateDeviceLastSeen(device.id);
    return { deviceId: device.id };
}

/** Rate-limit a device action. Returns true if the request should be rejected. */
export async function deviceRateLimited(deviceId: string, action: 'next' | 'ack'): Promise<boolean> {
    const limit = action === 'next' ? 1 : 5;
    return rateLimited(`printer:${action}:${deviceId}`, limit, 1000);
}
