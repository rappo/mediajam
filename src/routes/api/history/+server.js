import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/history — Paginated playback history timeline.
 * Query params: page (default 1), limit (default 50), type (optional: show|movie|artist)
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url }) {
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const mediaType = url.searchParams.get('type'); // 'show', 'movie', 'artist'
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params = [];

    if (mediaType) {
        whereClause = 'AND mp.media_type = ?';
        params.push(mediaType);
    }

    const entries = db.prepare(`
        SELECT
            ph.id,
            ph.timestamp,
            ph.duration_consumed_seconds,
            ph.completion_pct,
            ph.source,
            mc.title as item_title,
            mc.season_number,
            mc.item_number,
            mc.jellyfin_id as item_jellyfin_id,
            mp.title as parent_title,
            mp.media_type,
            mp.poster_url,
            mp.jellyfin_id as parent_jellyfin_id,
            u.username
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        JOIN users u ON ph.user_id = u.id
        ${whereClause}
        ORDER BY ph.timestamp DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const totalQuery = db.prepare(`
        SELECT COUNT(*) as count
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        ${whereClause}
    `).get(...params);

    const total = /** @type {any} */ (totalQuery)?.count || 0;

    return json({
        entries,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
    });
}
