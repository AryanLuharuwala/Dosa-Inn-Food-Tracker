import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/apiAuth';
import { getOrders } from '@/lib/localDb';
import { getSettings } from '@/lib/localDb';
import { buildBillDoc } from '@/lib/printer/receipt';
import { renderDocServer } from '@/lib/printer/render.server';
import { enqueuePrintJob } from '@/lib/printer/printerDb';

// Internal endpoint — called by the admin UI when "print bill" is triggered.
// Not exposed to the ESP32 bridge (bridge auth is bearer token; this requires
// admin session cookie). No CORS headers — same-origin only.

export async function POST(req: NextRequest) {
    if (!await isAdminRequest(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const orderId: unknown = body?.orderId;
    if (typeof orderId !== 'string' || !orderId) {
        return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }

    const [orders, settings] = await Promise.all([getOrders(), getSettings()]);
    const order = orders.find(o => o.orderId === orderId);
    if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const restaurantName: string = settings.restaurantName ?? 'Restaurant';
    const doc = buildBillDoc(order, restaurantName, settings.billTemplate);
    const { data, width, height } = await renderDocServer(doc);

    const jobId = await enqueuePrintJob(data, width, height);
    return NextResponse.json({ ok: true, jobId });
}
