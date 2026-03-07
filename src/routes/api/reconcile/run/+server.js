import { json } from '@sveltejs/kit';
import { runFullReconciliation, addReconcileListener, isReconcileRunning, stopReconciliation } from '$lib/server/llm-reconciler.js';

/**
 * POST /api/reconcile/run — Start reconciliation (SSE stream).
 * DELETE /api/reconcile/run — Stop running reconciliation.
 * @type {import('./$types').RequestHandler}
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    if (isReconcileRunning()) return json({ error: 'Reconciliation already running' }, { status: 409 });

    let useT3 = false;
    /** @type {string[]} */
    let skipPhases = [];
    try {
        const body = await request.json();
        useT3 = !!body.useT3;
        if (Array.isArray(body.skipPhases)) skipPhases = body.skipPhases;
    } catch { /* no body or invalid JSON — defaults apply */ }

    const userId = locals.user.id;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        start(controller) {
            /** @param {any} data */
            const send = (data) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* stream closed */ }
            };

            const removeListener = addReconcileListener(send);

            // Run in background — don't await in the stream start
            runFullReconciliation(userId, { useT3, skipPhases })
                .then((result) => {
                    send({ type: 'reconcile_complete', ...result });
                    try { controller.close(); } catch { /* */ }
                })
                .catch((err) => {
                    send({ type: 'reconcile_error', error: err.message || String(err) });
                    try { controller.close(); } catch { /* */ }
                })
                .finally(() => {
                    removeListener();
                });
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Accel-Buffering': 'no'
        }
    });
}

export async function DELETE({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
    stopReconciliation();
    return json({ success: true });
}
