import { json } from '@sveltejs/kit';
import {
    startMusicBrainzEnrich,
    pauseMusicBrainzEnrich,
    resumeMusicBrainzEnrich,
    stopMusicBrainzEnrich,
    addListener,
    isMBRunning,
    getMBStatus
} from '$lib/server/musicbrainz-engine.js';

/**
 * POST: action-based control (start, pause, resume, stop)
 * Same pattern as /api/people/sync POST.
 */
export async function POST({ request }) {
    const { action } = await request.json();

    switch (action) {
        case 'start':
            if (isMBRunning()) {
                return json({ error: 'MusicBrainz enrichment already running' }, { status: 409 });
            }
            startMusicBrainzEnrich();
            return json({ success: true, started: true });

        case 'pause':
            pauseMusicBrainzEnrich();
            return json({ success: true, message: 'Paused.' });

        case 'resume':
            resumeMusicBrainzEnrich();
            return json({ success: true, message: 'Resumed.' });

        case 'stop':
            stopMusicBrainzEnrich();
            return json({ success: true, message: 'Stopped.' });

        default:
            return json({ success: false, error: 'Invalid action.' }, { status: 400 });
    }
}

/**
 * GET: SSE stream for real-time MusicBrainz enrichment progress.
 * Same pattern as /api/people/sync GET.
 */
export async function GET() {
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

            // Send initial connection event
            send({ type: 'connected' });

            // Send current snapshot
            const status = getMBStatus();
            send({
                type: 'snapshot',
                running: status.status === 'syncing' || status.status === 'paused',
                paused: status.status === 'paused',
                status: status.status,
                progress: status.progress,
                itemsSynced: status.itemsSynced,
                errors: status.errors,
                logs: status.logs,
                result: status.result
            });

            // Subscribe to engine events
            const removeListener = addListener(send);

            // Keep-alive every 15s
            const keepAlive = setInterval(() => {
                try {
                    controller.enqueue(encoder.encode(`: keepalive\n\n`));
                } catch {
                    clearInterval(keepAlive);
                    removeListener();
                }
            }, 15000);
        },
        cancel() {
            // Cleanup happens when stream is cancelled
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
