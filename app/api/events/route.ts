import { NextRequest } from 'next/server';
import { subscribe } from '@/lib/serverEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/events?channel=menu   (or channel=shared-cart&code=ABC123)
export async function GET(req: NextRequest) {
    const channel = req.nextUrl.searchParams.get('channel') ?? 'menu';

    const stream = new ReadableStream({
        start(controller) {
            const enc = new TextEncoder();

            const send = (event: string, data: string) => {
                try {
                    controller.enqueue(enc.encode(`event: ${event}\ndata: ${data}\n\n`));
                } catch { /* client disconnected */ }
            };

            // Initial heartbeat so the connection is established immediately
            send('connected', '{}');

            const unsub = subscribe(channel, (resource: string) => send('change', JSON.stringify({ resource })));

            // Keepalive every 25s to prevent proxy timeouts
            const keepalive = setInterval(() => {
                try { controller.enqueue(enc.encode(': ping\n\n')); } catch { clearInterval(keepalive); }
            }, 25000);

            req.signal.addEventListener('abort', () => {
                unsub();
                clearInterval(keepalive);
                try { controller.close(); } catch { /* already closed */ }
            });
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
