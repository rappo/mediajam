import { fetchAllRatings } from '$lib/server/ratings-engine.js';
import { logInfo, logError } from '$lib/server/logger.js';

let running = false;

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
    if (running) {
        return new Response(JSON.stringify({ error: 'Ratings sync already in progress' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const body = await request.json().catch(() => ({}));
    const force = !!body.force;

    running = true;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (/** @type {any} */ data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* stream closed */ }
            };

            try {
                logInfo('ratings-sync', `Batch ratings fetch started (force=${force})`);
                const result = await fetchAllRatings({
                    force,
                    onProgress: send
                });
                logInfo('ratings-sync', `Batch ratings fetch done: ${result.fetched} fetched, ${result.errors} errors out of ${result.total} items`);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logError('ratings-sync', `Batch ratings fetch crashed: ${msg}`);
                send({ type: 'ratings_error', error: msg });
            } finally {
                running = false;
                try { controller.close(); } catch { /* already closed */ }
            }
        },
        cancel() {
            running = false;
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
