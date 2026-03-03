import { json } from '@sveltejs/kit';
import db from '$lib/server/db.js';

/**
 * GET /api/search?q=... — Global search across media and history.
 * Returns categorized results: shows, movies, music, history.
 * @type {import('./$types').RequestHandler}
 */
export async function GET({ url, locals }) {
    const query = url.searchParams.get('q')?.trim();
    if (!query || query.length < 2) {
        return json({ results: [], query: '' });
    }

    const userId = locals.user?.id;
    const like = `%${query}%`;

    // Search shows
    const shows = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year,
               mp.collected_children as episode_count, 'show' as type
        FROM media_parents mp
        WHERE mp.media_type = 'show' AND mp.title LIKE ?
        ORDER BY mp.title
        LIMIT 5
    `).all(like));

    // Search movies
    const movies = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url, mp.release_year, 'movie' as type
        FROM media_parents mp
        WHERE mp.media_type = 'movie' AND mp.title LIKE ?
        ORDER BY mp.title
        LIMIT 5
    `).all(like));

    // Search music (artists)
    const music = /** @type {any[]} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.poster_url,
               mp.collected_children as album_count, 'artist' as type
        FROM media_parents mp
        WHERE mp.media_type = 'artist' AND mp.title LIKE ?
        ORDER BY mp.title
        LIMIT 5
    `).all(like));

    // Search episodes/tracks by title
    const children = /** @type {any[]} */ (db.prepare(`
        SELECT mc.id, mc.title as item_title, mc.season_number, mc.item_number,
               mp.title as parent_title, mp.media_type, mp.poster_url, mp.id as parent_id,
               'child' as type
        FROM media_children mc
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE mc.title LIKE ?
        ORDER BY mp.title, mc.season_number, mc.item_number
        LIMIT 8
    `).all(like));

    // Search user's playback history
    const history = userId ? /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.completion_pct,
               mc.title as item_title, mc.season_number, mc.item_number,
               mp.title as parent_title, mp.media_type, mp.poster_url,
               'history' as type
        FROM playback_history ph
        JOIN media_children mc ON ph.media_id = mc.id
        JOIN media_parents mp ON mc.parent_id = mp.id
        WHERE ph.user_id = ? AND (mc.title LIKE ? OR mp.title LIKE ?)
        ORDER BY ph.timestamp DESC
        LIMIT 5
    `).all(userId, like, like)) : [];

    return json({
        query,
        results: {
            shows,
            movies,
            music,
            children,
            history
        },
        totalCount: shows.length + movies.length + music.length + children.length + history.length
    });
}
