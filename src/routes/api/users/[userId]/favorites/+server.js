import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/users/:userId/favorites — Most-watched/played items derived from history.
 * Query params: type (optional: show|movie|artist), limit (default 20)
 * Unauthenticated endpoint for external consumption.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ params, url }) {
    const userId = parseInt(params.userId);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const mediaType = url.searchParams.get('type');

    let whereClause = 'WHERE ph.user_id = ?';
    const queryParams = [userId];

    if (mediaType) {
        whereClause += ' AND mp.media_type = ?';
        queryParams.push(mediaType);
    }

    const favorites = db.prepare(`
        SELECT
            mp.id as parent_id,
            mp.title as parent_title,
            mp.media_type,
            mp.poster_url,
            mp.jellyfin_id as parent_jellyfin_id,
            COUNT(*) as play_count,
            SUM(ph.duration_consumed_seconds) as total_seconds,
            MAX(ph.timestamp) as last_played
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        ${whereClause}
        GROUP BY mp.id
        ORDER BY play_count DESC
        LIMIT ?
    `).all(...queryParams, limit);

    return json({
        userId,
        favorites
    });
}
