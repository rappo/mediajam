import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/watchlist
 * Return the current user's watchlist with media details.
 */
export async function GET({ locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const userId = locals.user.id;
    const items = db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.backdrop_url, mp.media_type, mp.slug,
               mp.release_year, mp.overview, w.added_at
        FROM watchlist w
        JOIN media_parents mp ON w.media_parent_id = mp.id
        WHERE w.user_id = ?
        ORDER BY w.added_at DESC
    `).all(userId);
    return json({ items });
}

/**
 * POST /api/watchlist
 * Toggle a media item on/off the user's watchlist.
 * Body: { mediaParentId: number }
 * Returns: { inWatchlist: boolean }
 */
export async function POST({ request, locals }) {
    if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

    const { mediaParentId } = await request.json();
    if (!mediaParentId) return json({ error: 'mediaParentId required' }, { status: 400 });

    const userId = locals.user.id;

    // Check if already in watchlist
    const existing = db.prepare(
        'SELECT id FROM watchlist WHERE user_id = ? AND media_parent_id = ?'
    ).get(userId, mediaParentId);

    if (existing) {
        // Remove from watchlist
        db.prepare('DELETE FROM watchlist WHERE user_id = ? AND media_parent_id = ?').run(userId, mediaParentId);
        return json({ inWatchlist: false });
    } else {
        // Add to watchlist
        db.prepare('INSERT INTO watchlist (user_id, media_parent_id) VALUES (?, ?)').run(userId, mediaParentId);
        return json({ inWatchlist: true });
    }
}
