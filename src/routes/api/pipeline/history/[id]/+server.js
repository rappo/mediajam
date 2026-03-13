import { json } from '@sveltejs/kit';
import { getRunDetail } from '$lib/server/nightly-pipeline.js';

/**
 * GET /api/pipeline/history/[id] — get full details for a pipeline run
 */
export async function GET({ params, locals }) {
    if (!locals.user?.isAdmin) return json({ error: 'Unauthorized' }, { status: 401 });

    const id = parseInt(params.id);
    if (isNaN(id)) return json({ error: 'Invalid ID' }, { status: 400 });

    const run = getRunDetail(id);
    if (!run) return json({ error: 'Not found' }, { status: 404 });

    return json(run);
}
