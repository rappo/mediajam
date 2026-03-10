import { reconcileExternalMedia, deduplicateParents, deduplicateChildren, deduplicateParentsByTitle, deduplicatePlaybackHistory, deduplicateExternalAlbums } from '$lib/server/reconcile.js';
import { smartMergeCompilations, autoMergeMediumPlus } from '$lib/server/album-matcher.js';
import { syncAllArr } from '$lib/server/arr-sync.js';
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
        const titleDedup = deduplicateParentsByTitle();
        const historyDedup = deduplicatePlaybackHistory();

        // Deduplicate external music album title variants ("Vol. 4" vs "Vol 4" etc)
        const albumDedup = deduplicateExternalAlbums();

        // Auto-merge external albums into matching Jellyfin albums (exact, high, medium confidence)
        const albumMerge = autoMergeMediumPlus();

        // Smart-merge compilations: route individual plays from best-of/compilation
        // albums to the correct studio albums based on track name matching
        const compilationMerge = smartMergeCompilations();

        // Sync *arr services
        let arrSummary = '';
        try {
            const arrResult = await syncAllArr();
            const arrParts = [];
            for (const [svc, r] of Object.entries(arrResult.results)) {
                arrParts.push(`${svc}: ${r.matched} matched${r.created ? ` + ${r.created} created` : ''} / ${r.total}`);
            }
            if (arrParts.length > 0) arrSummary = `, arr: ${arrParts.join(', ')}`;
        } catch (e) {
            console.error('[reconcile] arr-sync error:', e);
        }

        const albumDedupSummary = albumDedup.deduped > 0 ? `, ${albumDedup.deduped} album title variants merged` : '';
        const albumMergeSummary = albumMerge.merged > 0 ? `, ${albumMerge.merged} albums matched to library (${albumMerge.totalPlays} plays moved)` : '';
        const compilationSummary = compilationMerge.merged > 0 ? `, ${compilationMerge.merged} compilations merged (${compilationMerge.playsRouted} plays routed)` : '';
        const summary = `${result.merged} merged, ${result.deleted} orphans, ${dedupResult.deduped + titleDedup.deduped} deduped parents, ${childDedup.deduped} deduped children, ${historyDedup.removed} duplicate plays removed${albumDedupSummary}${albumMergeSummary}${compilationSummary}${arrSummary}`;
        console.log(`[reconcile] Manual: ${summary}`);
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
            .run('success', new Date().toISOString(), summary, histId);
        return json({ success: true, ...result, ...dedupResult, titleDeduped: titleDedup.deduped, childrenDeduped: childDedup.deduped, childHistoryMoved: childDedup.historyMoved, historyDupsRemoved: historyDedup.removed, compilationsMerged: compilationMerge.merged, playsRouted: compilationMerge.playsRouted });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.prepare('UPDATE sync_history SET status = ?, finished_at = ?, summary = ? WHERE id = ?')
            .run('failed', new Date().toISOString(), msg, histId);
        return json({ error: msg }, { status: 500 });
    }
}
