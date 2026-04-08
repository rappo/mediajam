import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/reconcile/unmatched — Get unmatched (external) items grouped by media type.
 * Query params: type (artist|movie|show), page (1-indexed), limit (default 50),
 *               sort (title|plays|children), dir (asc|desc)
 */
export async function GET({ url, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const type = url.searchParams.get('type') || 'artist';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const offset = (page - 1) * limit;

    // Sort handling
    const sortParam = url.searchParams.get('sort') || 'plays';
    const dirParam = (url.searchParams.get('dir') || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortMap = {
        title: `mp.title ${dirParam === 'DESC' ? 'DESC' : 'ASC'}`,
        plays: `play_count ${dirParam}`,
        children: `child_count ${dirParam}`,
    };
    const orderBy = sortMap[/** @type {keyof typeof sortMap} */ (sortParam)] || sortMap.plays;

    // Count totals per type
    const typeCounts = /** @type {any[]} */ (db.prepare(`
        SELECT media_type, COUNT(*) as cnt
        FROM media_parents WHERE jellyfin_id IS NULL
        GROUP BY media_type
    `).all());

    const counts = { artist: 0, movie: 0, show: 0 };
    for (const row of typeCounts) {
        if (row.media_type in counts) {
            counts[/** @type {keyof typeof counts} */ (row.media_type)] = row.cnt;
        }
    }

    // Fetch items for the requested type with play counts
    const items = /** @type {any[]} */ (db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.musicbrainz_id,
            mp.tmdb_id,
            mp.imdb_id,
            mp.release_year,
            (SELECT COUNT(*) FROM media_children mc WHERE mc.parent_id = mp.id) AS child_count,
            (SELECT COUNT(*) FROM playback_history ph
             JOIN media_children mc2 ON ph.media_id = mc2.id
             WHERE mc2.parent_id = mp.id) AS play_count
        FROM media_parents mp
        WHERE mp.jellyfin_id IS NULL AND mp.media_type = ?
        ORDER BY ${orderBy}, mp.title ASC
        LIMIT ? OFFSET ?
    `).all(type, limit, offset));

    const total = counts[/** @type {keyof typeof counts} */ (type)] || 0;

    return json({
        counts,
        type,
        items,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    });
}
