import { reconcileExternalMedia, deduplicateParents, deduplicateChildren } from '$lib/server/reconcile.js';
import db from '$lib/server/db.js';
import { json } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export async function POST({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const startedAt = new Date().toISOString();
    const histResult = db.prepare(
        `INSERT INTO sync_history (sync_type, status, started_at) VALUES ('reconcile', 'running', ?)`
    ).run(startedAt);
    const histId = Number(histResult.lastInsertRowid);

    try {
        const result = reconcileExternalMedia();
        const dedupResult = deduplicateParents();
        const childDedup = deduplicateChildren();
        const summary = `${result.merged} merged, ${result.deleted} orphans, ${dedupResult.deduped} deduped parents, ${childDedup.deduped} deduped children`;
        console.log(`[reconcile] Manual: ${summary}`);
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
            .run('success', new Date().toISOString(), summary, histId);
        return json({ success: true, ...result, ...dedupResult, childrenDeduped: childDedup.deduped, childHistoryMoved: childDedup.historyMoved });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
            .run('failed', new Date().toISOString(), msg, histId);
        return json({ error: msg }, { status: 500 });
    }
}
