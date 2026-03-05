import { json } from '@sveltejs/kit';
import { getLatestRun } from '$lib/server/llm-reconciler.js';

/**
 * GET /api/reconcile/run/report — Get latest reconciliation run report.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const run = getLatestRun(locals.user.id);
    if (!run) return json({ error: 'No reconciliation runs found' }, { status: 404 });

    return json(run);
}
