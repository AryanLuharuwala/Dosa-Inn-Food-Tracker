import { NextRequest, NextResponse } from 'next/server';
import { requireDeviceToken, deviceRateLimited } from '@/lib/printer/auth';
import { claimNextJob, getDeviceSettings } from '@/lib/printer/printerDb';
import { FEED_LINES } from '@/lib/printer/types';

// Long-polling endpoint. With ?wait=<seconds> (0..30) the request blocks on
// the server until a job appears or the timeout elapses. The response is
// always 200 with this shape so the ESP can apply settings on every poll
// even when there's no job to print:
//   { settings: { role, speed, energy }, job: null | { id, width, height, bitmap_b64 } }

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_SECONDS = 30;

export async function GET(req: NextRequest) {
    const auth = await requireDeviceToken(req);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const waitRaw = req.nextUrl.searchParams.get('wait');
    const waitSec = Math.min(Math.max(parseInt(waitRaw ?? '0', 10) || 0, 0), MAX_WAIT_SECONDS);

    if (await deviceRateLimited(auth.deviceId, 'next')) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const settings = await getDeviceSettings(auth.deviceId);

    // `requireDeviceToken` above already updated last_seen_at once for this
    // request, which is enough — the 120s UI threshold in useEspPrinterStatus
    // gracefully spans the whole 25s long-poll plus the next request, so we
    // don't need per-second writes during the wait loop.
    const deadline = Date.now() + waitSec * 1000;
    let job = await claimNextJob(auth.deviceId);
    while (!job && Date.now() < deadline) {
        if (req.signal?.aborted) return new NextResponse(null, { status: 499 });
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        job = await claimNextJob(auth.deviceId);
    }

    return NextResponse.json({
        settings,
        job: job ? {
            id:         job.id,
            width:      job.width,
            height:     job.height,
            bitmap_b64: job.payload.toString('base64'),
            feed_lines: FEED_LINES,
            copies:     job.copies ?? 1,
        } : null,
    });
}
