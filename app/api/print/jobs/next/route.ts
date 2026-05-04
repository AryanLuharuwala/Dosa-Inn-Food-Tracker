import { NextRequest, NextResponse } from 'next/server';
import { requireDeviceToken, deviceRateLimited } from '@/lib/printer/auth';
import { claimNextJob } from '@/lib/printer/printerDb';
import { FEED_LINES } from '@/lib/printer/types';

export async function GET(req: NextRequest) {
    const auth = await requireDeviceToken(req);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (await deviceRateLimited(auth.deviceId, 'next')) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const job = await claimNextJob(auth.deviceId);
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
