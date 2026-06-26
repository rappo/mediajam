import { json } from '@sveltejs/kit';
import { processArrWebhook, addArrEventListener, getRecentEvents } from '$lib/server/arr-events.js';

/**
 * POST /api/arr/webhook — Receive webhook payloads from Radarr/Sonarr/Lidarr.
 * Accepts optional ?service=radarr query param, otherwise auto-detects from payload shape.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, url }) {
    try {
        const payload = await request.json();
        const service = url.searchParams.get('service') || null;
        const result = processArrWebhook(payload, service);
        return json({ success: true, ...result });
    } catch (e) {
        console.error('[arr-webhook] Processing error:', e instanceof Error ? e.message : String(e));
        return json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
}

/**
 * GET /api/arr/webhook — SSE stream for real-time *arr events.
 * Clients subscribe to receive webhook events as they arrive.
 * @type {import('./$types').RequestHandler}
 */
export async function GET() {
    /** @type {(() => void) | null} */
    let cleanupFn = null;

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (/** @type {any} */ data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // Stream closed
                }
            };

            // Send recent events on connect
            const recentEvents = getRecentEvents(10);
            send({ type: 'connected', recentEvents });

            // Subscribe to arr event broadcasts
            const removeListener = addArrEventListener(send);

            // Keep-alive every 15 seconds
            const keepAlive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`: keepalive\n\n`));
                } catch {
                    clearInterval(keepAlive);
                    removeListener();
                }
            }, 15000);

            cleanupFn = () => {
                removeListener();
                clearInterval(keepAlive);
            };
        },
        cancel() {
            if (cleanupFn) cleanupFn();
        }
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
