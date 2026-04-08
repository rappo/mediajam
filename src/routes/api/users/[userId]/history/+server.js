import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/users/:userId/history — Paginated playback history for a user.
 * Query params: page (default 1), limit (default 50), type (optional: show|movie|artist)
 * Unauthenticated endpoint for external consumption.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ params, url }) {
    const userId = parseInt(params.userId);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const mediaType = url.searchParams.get('type');
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE ph.user_id = ?';
    const queryParams = [userId];

    if (mediaType) {
        whereClause += ' AND mp.media_type = ?';
        queryParams.push(mediaType);
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
            mp.title as parent_title,
            mp.media_type,
            mp.poster_url,
            mp.jellyfin_id as parent_jellyfin_id,
            ph.track_name
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        ${whereClause}
        ORDER BY ph.timestamp DESC
        LIMIT ? OFFSET ?
    `).all(...queryParams, limit, offset);

    const total = /** @type {any} */ (db.prepare(`
        SELECT COUNT(*) as count FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        ${whereClause}
    `).get(...queryParams))?.count || 0;

    return json({
        userId,
        entries,
        page, limit, total,
        totalPages: Math.ceil(total / limit)
    });
}
