import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/stats?type=track&id=123
 * GET /api/stats?type=album&id=456
 * GET /api/stats?type=artist&id=789
 * GET /api/stats?type=movie&id=101
 * GET /api/stats?type=show&id=202
 *
 * Returns: { play_count, last_played, first_played }
 *
 * type = track|album|artist|movie|show
 * id = media_children.id (track/album) or media_parents.id (artist/movie/show)
 */
export function GET({ url, locals }) {
    const userId = locals.user?.id;
    if (!userId) return json({ error: 'Not authenticated' }, { status: 401 });

    const type = url.searchParams.get('type');
    const id = parseInt(url.searchParams.get('id') || '0');
    if (!type || !id) return json({ error: 'Missing type or id' }, { status: 400 });

    /** @type {any} */
    let stats = null;

    if (type === 'track' || type === 'album') {
        // media_children.id — direct match on media_id (deduplicated by 12-hour window)
        stats = db.prepare(`
            SELECT
                COUNT(*) as play_count,
                MAX(timestamp) as last_played,
                MIN(timestamp) as first_played
            FROM (
                SELECT DISTINCT media_id, CAST(strftime('%s', timestamp) / 43200 AS INTEGER) as time_bucket,
                       MAX(timestamp) as timestamp, MIN(timestamp) as min_ts
                FROM playback_history
                WHERE media_id = ? AND user_id = ?
                GROUP BY media_id, time_bucket
            )
        `).get(id, userId);
        if (stats) {
            stats.first_played = stats.min_ts || stats.first_played;
        }
    } else if (type === 'artist' || type === 'show' || type === 'movie') {
        // media_parents.id — aggregate across all children (deduplicated by 12-hour window)
        stats = db.prepare(`
            SELECT
                COUNT(*) as play_count,
                MAX(timestamp) as last_played,
                MIN(timestamp) as first_played
            FROM (
                SELECT DISTINCT ph.media_id, CAST(strftime('%s', ph.timestamp) / 43200 AS INTEGER) as time_bucket,
                       MAX(ph.timestamp) as timestamp, MIN(ph.timestamp) as min_ts
                FROM playback_history ph
                JOIN media_children mc ON ph.media_id = mc.id
                WHERE mc.parent_id = ? AND ph.user_id = ?
                GROUP BY ph.media_id, time_bucket
            )
        `).get(id, userId);
        if (stats) {
            stats.first_played = stats.min_ts || stats.first_played;
        }
    } else {
        return json({ error: 'Invalid type. Use: track, album, artist, movie, show' }, { status: 400 });
    }

    return json({
        type,
        id,
        play_count: stats?.play_count || 0,
        last_played: stats?.last_played || null,
        first_played: stats?.first_played || null
    });
}
