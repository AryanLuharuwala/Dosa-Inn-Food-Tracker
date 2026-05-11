import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { getOrders, getSettings } from '@/lib/localDb';
import { buildBillDoc, buildKOTDoc, buildTestDoc, buildStatsDoc } from '@/lib/printer/receipt';
import { renderDocServer } from '@/lib/printer/render.server';
import { enqueuePrintJob, listJobs } from '@/lib/printer/printerDb';
import type { DocLine } from '@/lib/printer/types';

export async function GET(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const jobs = await listJobs();
    return NextResponse.json(jobs);
}

// Internal endpoint — called by the admin UI for any print action.
// Requires admin session (not ESP32 bearer token).
//
// Body: { orderId?: string, kind: 'bill' | 'kot' | 'test' | 'stats' }
// - 'bill' / 'kot' require orderId
// - 'test' / 'stats' don't

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const kind: string = body?.kind ?? 'bill';
    const orderId: unknown = body?.orderId;

    if (!['bill', 'kot', 'test', 'stats'].includes(kind)) {
        return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
    }

    const settings = await getSettings();
    const restaurantName: string = settings.restaurantName ?? 'Restaurant';

    let doc: DocLine[];
    if (kind === 'bill' || kind === 'kot') {
        if (typeof orderId !== 'string' || !orderId) {
            return NextResponse.json({ error: 'orderId required for bill/kot' }, { status: 400 });
        }
        const orders = await getOrders();
        const order = orders.find(o => o.orderId === orderId);
        if (!order) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }
        doc = kind === 'bill'
            ? buildBillDoc(order, restaurantName, settings.billTemplate)
            : buildKOTDoc(order, restaurantName);
    } else if (kind === 'test') {
        doc = buildTestDoc(restaurantName);
    } else {
        const orders = await getOrders();
        doc = buildStatsDoc(orders, restaurantName);
    }

    const { data, width, height } = await renderDocServer(doc);
    const jobId = await enqueuePrintJob(data, width, height, kind as 'bill' | 'kot' | 'test' | 'stats');
    return NextResponse.json({ ok: true, jobId, kind });
}
