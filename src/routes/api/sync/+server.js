import { json } from '@sveltejs/kit';
import { startSync, pauseSync, resumeSync, stopSync, resetSync, addListener, isRunning } from '$lib/server/sync-engine.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    const { action, libraryId } = await request.json();

    switch (action) {
        case 'start':
            if (isRunning()) {
                // Force-reset stuck state (common after HMR or server restart)
                resetSync();
            }
            // Start sync in background (don't await)
            startSync(libraryId || null);
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
export async function GET() {
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // Stream closed
                }
            };

            // Send initial state
            send({ type: 'connected' });

            // Subscribe to sync engine events
            const removeListener = addListener(send);

            // Keep-alive every 15 seconds
            const keepAlive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`: keepalive\n\n`));
                } catch {
                    clearInterval(keepAlive);
                }
            }, 15000);

            // Cleanup on close is handled via the reader cancel
        },
        cancel() {
            // Cleanup happens when stream is cancelled
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
