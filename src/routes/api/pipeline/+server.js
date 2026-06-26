import { json } from '@sveltejs/kit';
import {
    runPipeline,
    isPipelineRunning,
    getPipelineStatus,
    getPipelineSettings,
    updatePipelineSettings,
    addPipelineListener,
    stopPipeline,
    restartPipelineScheduler,
    PHASES,
} from '$lib/server/nightly-pipeline.js';

/**
 * GET /api/pipeline — status + settings + phase list
 */
export async function GET({ locals }) {
    if (!locals.user?.isAdmin) return json({ error: 'Unauthorized' }, { status: 401 });

    const status = getPipelineStatus();
    const settings = getPipelineSettings();
    const phases = PHASES.map(p => ({ id: p.id, label: p.label, schedule: p.schedule }));

    return json({ ...status, ...settings, phases });
}

/**
 * POST /api/pipeline — run pipeline with SSE streaming output
 * Body: { mode: 'nightly' | 'weekly' }
 */
export async function POST({ request, locals }) {
    if (!locals.user?.isAdmin) return json({ error: 'Unauthorized' }, { status: 401 });

    if (isPipelineRunning()) {
        return json({ error: 'Pipeline is already running' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === 'weekly' ? 'weekly' : 'nightly';

    // SSE stream
    let cleanupFn;
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            function send(data) {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch { /* stream closed */ }
            }

            const removeListener = addPipelineListener((event) => {
                send(event);
                if (event.type === 'pipeline_end') {
                    removeListener();
                    try { controller.close(); } catch { /* already closed */ }
                }
            });
            cleanupFn = () => { removeListener(); };

            // Start pipeline in background
            runPipeline(mode).then((result) => {
                send({ type: 'result', ...result });
                removeListener();
                try { controller.close(); } catch { /* already closed */ }
            }).catch((err) => {
                send({ type: 'error', error: err.message || String(err) });
                removeListener();
                try { controller.close(); } catch { /* already closed */ }
            });
        },
        cancel() {
            if (cleanupFn) cleanupFn();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        }
    });
}

/**
 * PUT /api/pipeline — update pipeline settings
 * Body: { pipelineEnabled, nightlyTime, weeklyDay, weeklyTime, phaseFlags }
 */
export async function PUT({ request, locals }) {
    if (!locals.user?.isAdmin) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    updatePipelineSettings(body);
    restartPipelineScheduler();

    return json({ success: true, ...getPipelineSettings() });
}

/**
 * DELETE /api/pipeline — stop a running pipeline
 */
export async function DELETE({ locals }) {
    if (!locals.user?.isAdmin) return json({ error: 'Unauthorized' }, { status: 401 });

    if (!isPipelineRunning()) {
        return json({ error: 'Pipeline is not running' }, { status: 400 });
    }

    stopPipeline();
    return json({ success: true });
}
