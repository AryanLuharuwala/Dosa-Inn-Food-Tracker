import { NextRequest, NextResponse } from 'next/server';
import { requireDeviceToken, deviceRateLimited } from '@/lib/printer/auth';
import { claimNextJob, updateDeviceLastSeen } from '@/lib/printer/printerDb';
import { FEED_LINES } from '@/lib/printer/types';

// Long-polling endpoint. With ?wait=<seconds> (0..30) the request blocks on
// the server until a job appears or the timeout elapses, then returns 200 or
// 204. This collapses the ESP32's poll rate from ~30/min to ~2/min while
// keeping job dispatch latency under 1 second.

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_SECONDS = 30;

export async function GET(req: NextRequest) {
    const auth = await requireDeviceToken(req);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const waitRaw = req.nextUrl.searchParams.get('wait');
    const waitSec = Math.min(Math.max(parseInt(waitRaw ?? '0', 10) || 0, 0), MAX_WAIT_SECONDS);

    // Rate-limit only the initial request, not every internal poll tick.
    if (await deviceRateLimited(auth.deviceId, 'next')) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const deadline = Date.now() + waitSec * 1000;
    let job = await claimNextJob(auth.deviceId);
    while (!job && Date.now() < deadline) {
        // The client may close the connection before our timeout; bail early.
        if (req.signal?.aborted) return new NextResponse(null, { status: 499 });
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        // Refresh last_seen so the admin UI sees the device as online even
        // during a long wait window.
        await updateDeviceLastSeen(auth.deviceId).catch(() => {});
        job = await claimNextJob(auth.deviceId);
    }

    if (!job) {
        return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json({
        id:         job.id,
        width:      job.width,
        height:     job.height,
        bitmap_b64: job.payload.toString('base64'),
        feed_lines: FEED_LINES,
    });
}
