import { reconcileExternalMedia, deduplicateParents, deduplicateChildren } from '$lib/server/reconcile.js';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const result = reconcileExternalMedia();
    const dedupResult = deduplicateParents();
    const childDedup = deduplicateChildren();
    console.log(`[reconcile] Manual: merged ${result.merged} refs, deleted ${result.deleted} orphans, deduped ${dedupResult.deduped} parents, ${childDedup.deduped} children`);
    return json({ success: true, ...result, ...dedupResult, childrenDeduped: childDedup.deduped, childHistoryMoved: childDedup.historyMoved });
}
