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
        // media_children.id — direct match on media_id
        stats = db.prepare(`
            SELECT
                COUNT(*) as play_count,
                MAX(timestamp) as last_played,
                MIN(timestamp) as first_played
            FROM playback_history
            WHERE media_id = ? AND user_id = ?
        `).get(id, userId);
    } else if (type === 'artist' || type === 'show' || type === 'movie') {
        // media_parents.id — aggregate across all children
        stats = db.prepare(`
            SELECT
                COUNT(*) as play_count,
                MAX(ph.timestamp) as last_played,
                MIN(ph.timestamp) as first_played
            FROM playback_history ph
            JOIN media_children mc ON ph.media_id = mc.id
            WHERE mc.parent_id = ? AND ph.user_id = ?
        `).get(id, userId);
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
