import { json } from '@sveltejs/kit';
import { startSync, pauseSync, resumeSync, stopSync, resetSync, addListener, isRunning, getStatus } from '$lib/server/sync-engine.js';
import { BUILD_VERSION } from '$lib/version.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { action, libraryId, force } = await request.json();
    console.log(`[sync][DEBUG] POST /api/sync — action=${action} build=${BUILD_VERSION}`);

    switch (action) {
        case 'start':
            if (isRunning()) {
                // Force-reset stuck state (common after HMR or server restart)
                resetSync();
            }
            // Start sync in background (don't await)
            startSync(libraryId || null, !!force);
            return json({ success: true, message: libraryId ? 'Library sync started.' : 'Sync started.' });

        case 'pause':
            pauseSync();
            return json({ success: true, message: 'Sync paused.' });

        case 'resume':
            resumeSync();
            return json({ success: true, message: 'Sync resumed.' });

        case 'stop':
            stopSync();
            return json({ success: true, message: 'Sync stopped.' });

        default:
            return json({ success: false, error: 'Invalid action.' }, { status: 400 });
    }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ request }) {
    console.log(`[sync][DEBUG] GET /api/sync — SSE connection opened, build=${BUILD_VERSION}`);
    console.log(`[sync][DEBUG]   User-Agent: ${request.headers.get('user-agent')?.slice(0, 60)}`);
    console.log(`[sync][DEBUG]   Accept: ${request.headers.get('accept')}`);
    console.log(`[sync][DEBUG]   Cookie present: ${!!request.headers.get('cookie')}`);

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

            // Send initial state
            send({ type: 'connected' });

            // Send current snapshot if sync is running
            const status = getStatus();
            if (status.running) {
                send({
                    type: 'snapshot',
                    running: status.running,
                    paused: status.paused,
                    libraryName: status.libraryName,
                    progress: status.progress,
                    itemsSynced: status.itemsSynced,
                    errors: status.errors,
                    logs: status.logs
                });
            }

            // Subscribe to sync engine events
            const removeListener = addListener(send);

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
