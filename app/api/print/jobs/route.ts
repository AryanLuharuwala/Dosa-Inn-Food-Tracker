import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, rateLimited } from '@/lib/apiAuth';
import { getOrders, getSettings } from '@/lib/localDb';
import { buildBillDoc, buildKOTDoc, buildTestDoc, buildStatsDoc } from '@/lib/printer/receipt';
import { renderDocServer } from '@/lib/printer/render.server';
import { enqueuePrintJob, listJobs, autoKotDedupKey } from '@/lib/printer/printerDb';
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
    // copies: number of prints from a single fetch. Defaults: caller-supplied,
    // else use the relevant setting (kotCopies / billCopies), else 1.
    const explicitCopies: unknown = body?.copies;
    // Set only by admin/page.tsx's own auto-print-on-arrival effect — never by
    // a manual "Print KOT"/"Print Bill" button click. order_add already
    // enqueues the same KOT unconditionally server-side; this flag shares its
    // dedup key so the two auto-triggers can't both create a job for the same
    // order, while manual reprints stay completely unaffected.
    const isAutoTrigger: boolean = body?.auto === true;

    if (!['bill', 'kot', 'test', 'stats'].includes(kind)) {
        return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
    }

    if (isAutoTrigger && kind === 'kot' && typeof orderId === 'string' && orderId) {
        if (await rateLimited(autoKotDedupKey(orderId), 1, 10 * 60_000)) {
            return NextResponse.json({ ok: true, deduped: true });
        }
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

    const copies =
        typeof explicitCopies === 'number' && explicitCopies > 0 ? explicitCopies :
        kind === 'kot'  ? (settings.kotCopies  ?? 1) :
        kind === 'bill' ? (settings.billCopies ?? 1) :
        1;

    const { data, width, height } = await renderDocServer(doc);
    const jobId = await enqueuePrintJob(data, width, height, kind as 'bill' | 'kot' | 'test' | 'stats', copies);
    return NextResponse.json({ ok: true, jobId, kind, copies });
}
