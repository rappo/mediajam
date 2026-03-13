import { json } from '@sveltejs/kit';
import { getRunHistory, getRunDetail } from '$lib/server/nightly-pipeline.js';

/**
 * GET /api/pipeline/history — list recent pipeline runs
 * Query: ?limit=20
 */
export async function GET({ url, locals }) {
    if (!locals.user?.isAdmin) return json({ error: 'Unauthorized' }, { status: 401 });

    const limit = parseInt(url.searchParams.get('limit') || '20');
    const history = getRunHistory(limit);
    return json({ history });
}
