import { json } from '@sveltejs/kit';
import { processWebhook, addIngestListener, getActivePlaying } from '$lib/server/ingest-engine.js';

/**
 * POST /api/ingest — Receive Jellyfin webhook payloads.
 * The Jellyfin Webhook Plugin should point to this URL.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request }) {
    try {
        const payload = await request.json();
        const result = processWebhook(payload);
        return json({ success: true, ...result });
    } catch (e) {
        console.error('[ingest] Webhook processing error:', e instanceof Error ? e.message : String(e));
        return json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
}

/**
 * GET /api/ingest — SSE stream for Now Playing updates.
 * Clients subscribe to receive real-time playback events.
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

            // Send current active sessions on connect
            const activeSessions = getActivePlaying();
            send({ type: 'connected', activeSessions });

            // Subscribe to ingest engine events
            const removeListener = addIngestListener(send);

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
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    });
}
