import { json } from '@sveltejs/kit';
import {
    syncJellyfinHistory,
    addJellyfinHistoryListener,
    isJellyfinHistoryRunning,
    getJellyfinHistoryStatus
} from '$lib/server/jellyfin-history-engine.js';

/**
 * POST /api/backfill/jellyfin — Start Jellyfin history sync.
 */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!locals.user.isAdmin) return json({ error: 'Admin required' }, { status: 403 });

    if (isJellyfinHistoryRunning()) {
        return json({ success: false, error: 'Already running.' }, { status: 409 });
    }

    // Start in background
    syncJellyfinHistory(locals.user.id).catch(err => {
        console.error('[jellyfin-history] Sync crashed:', err);
    });

    return json({ success: true, message: 'Jellyfin history sync started.' });
}

/**
 * GET /api/backfill/jellyfin — SSE stream for sync progress.
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

            send({ type: 'connected', isRunning: isJellyfinHistoryRunning() });

            // Send snapshot if running
            const status = getJellyfinHistoryStatus();
            if (status.running) {
                send({
                    type: 'snapshot',
                    running: true,
                    logs: status.logs,
                });
            }

            const removeListener = addJellyfinHistoryListener(send);

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
