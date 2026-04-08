import { json } from '@sveltejs/kit';
import {
    backfillWikipedia, stopWikipediaBackfill,
    addWikipediaListener, isWikipediaBackfillRunning, getWikipediaBackfillStatus
} from '$lib/server/wikipedia-backfill.js';

/**
 * POST /api/backfill/wikipedia — Start or stop Wikipedia backfill
 * Body: { action: 'start' | 'stop' }
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ success: false, error: 'Not authenticated.' }, { status: 401 });

    const { action } = await request.json();

    if (action === 'stop') {
        stopWikipediaBackfill();
        return json({ success: true, message: 'Wikipedia backfill stopped.' });
    }

    if (isWikipediaBackfillRunning()) {
        return json({ success: false, error: 'Wikipedia backfill is already running.' }, { status: 409 });
    }

    // Start in background
    backfillWikipedia();
    return json({ success: true, message: 'Wikipedia backfill started.' });
}

/**
 * GET /api/backfill/wikipedia — SSE stream for progress
 * @type {import('./$types').RequestHandler}
 */
export async function GET() {
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            const send = (/** @type {any} */ data) => {
                try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
                catch { /* stream closed */ }
            };

            send({ type: 'connected', isRunning: isWikipediaBackfillRunning() });

            const status = getWikipediaBackfillStatus();
            if (status.running) {
                send({ type: 'snapshot', ...status });
            }

            const removeListener = addWikipediaListener(send);

            const keepAlive = setInterval(() => {
                try { controller.enqueue(encoder.encode(`: keepalive\n\n`)); }
                catch { clearInterval(keepAlive); }
            }, 15000);
        },
        cancel() { }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    });
}
