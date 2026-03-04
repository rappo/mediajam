import { json } from '@sveltejs/kit';
import {
    startPeopleSync,
    pausePeopleSync,
    resumePeopleSync,
    stopPeopleSync,
    isPeopleRunning,
    getPeopleStatus,
    addListener
} from '$lib/server/people-sync-engine.js';

/**
 * POST: action-based control (start, pause, resume, stop)
 * Same pattern as /api/sync POST.
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { action } = await request.json();

    switch (action) {
        case 'start':
            if (isPeopleRunning()) {
                return json({ error: 'People sync already running' }, { status: 409 });
            }
            // Fire-and-forget
            startPeopleSync();
            return json({ success: true, started: true });

        case 'pause':
            pausePeopleSync();
            return json({ success: true, message: 'People sync paused.' });

        case 'resume':
            resumePeopleSync();
            return json({ success: true, message: 'People sync resumed.' });

        case 'stop':
            stopPeopleSync();
            return json({ success: true, message: 'People sync stopped.' });

        default:
            return json({ success: false, error: 'Invalid action.' }, { status: 400 });
    }
}

/**
 * GET: SSE stream for real-time people sync progress.
 * Same pattern as /api/sync GET.
 */
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

            // Send initial connection event
            send({ type: 'connected' });

            // Send current snapshot if sync is running
            const status = getPeopleStatus();
            if (status.running) {
                send({
                    type: 'snapshot',
                    running: status.running,
                    paused: status.paused,
                    progress: status.progress,
                    itemsSynced: status.itemsSynced,
                    errors: status.errors,
                    logs: status.logs,
                    totalPersons: status.totalPersons,
                    totalCredits: status.totalCredits
                });
            } else {
                send({
                    type: 'snapshot',
                    running: false,
                    totalPersons: status.totalPersons,
                    totalCredits: status.totalCredits
                });
            }

            // Subscribe to engine events
            const removeListener = addListener(send);

            // Keep-alive every 15s
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
