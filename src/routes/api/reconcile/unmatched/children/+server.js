import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/reconcile/unmatched/children?parentId=123 — Get children for an unmatched parent.
 * Returns albums/episodes/tracks for a given media_parent.
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const parentId = parseInt(url.searchParams.get('parentId') || '0');
    if (!parentId) return json({ error: 'parentId required' }, { status: 400 });

    const children = /** @type {any[]} */ (db.prepare(`
        SELECT
            mc.id,
            mc.title,
            mc.item_number,
            mc.season_number,
            mc.is_collected,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks,
            (SELECT COUNT(*) FROM playback_history ph WHERE ph.media_id = mc.id) AS history_count
        FROM media_children mc
        WHERE mc.parent_id = ?
        ORDER BY mc.season_number ASC, mc.item_number ASC, mc.title ASC
    `).all(parentId));

    return json({ parentId, children });
}
