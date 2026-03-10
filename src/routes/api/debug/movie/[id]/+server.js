import db from '$lib/server/db.js';
import { json, error } from '@sveltejs/kit';

/** @type {import('./$types').RequestHandler} */
export function GET({ params, locals }) {
    if (!locals.user) throw error(401, 'Unauthorized');

    const movieId = parseInt(params.id);
    if (!movieId) throw error(400, 'Invalid ID');

    // Get the movie and its child
    const movie = /** @type {any} */ (db.prepare(`
        SELECT mp.id, mp.title, mp.tmdb_id, mp.jellyfin_id,
               mc.id as child_id, mc.play_count
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.id = ? AND mp.media_type = 'movie'
    `).get(movieId));

    if (!movie) throw error(404, 'Movie not found');

    // Get all playback history entries
    const history = /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.source, ph.duration_consumed_seconds,
               ph.completion_pct, ph.external_event_id, ph.created_at
        FROM playback_history ph
        WHERE ph.media_id = ? AND ph.user_id = ?
        ORDER BY ph.timestamp DESC
    `).all(movie.child_id || 0, locals.user.id));

    // Also check trakt_history for this movie's tmdb_id
    const traktHistory = movie.tmdb_id ? /** @type {any[]} */ (db.prepare(`
        SELECT th.trakt_id, th.watched_at, th.title, th.tmdb_id, th.imdb_id, th.trakt_slug
        FROM trakt_history th
        WHERE th.tmdb_id = ? AND th.user_id = ? AND th.type = 'movie'
        ORDER BY th.watched_at DESC
    `).all(movie.tmdb_id, locals.user.id)) : [];

    // Fallback: search by title if tmdb_id didn't match
    const traktByTitle = traktHistory.length === 0 ? /** @type {any[]} */ (db.prepare(`
        SELECT th.trakt_id, th.watched_at, th.title, th.tmdb_id, th.imdb_id, th.trakt_slug
        FROM trakt_history th
        WHERE th.user_id = ? AND th.type = 'movie'
          AND (th.title LIKE ? OR th.trakt_slug LIKE ?)
        ORDER BY th.watched_at DESC
        LIMIT 5
    `).all(locals.user.id, `%${movie.title.replace(/[?']/g, '_')}%`, `%brother%`)) : [];

    // Count total trakt_history entries for diagnostic purposes
    const traktTotal = /** @type {any} */ (db.prepare(
        'SELECT COUNT(*) as c FROM trakt_history WHERE user_id = ?'
    ).get(locals.user.id));

    return json({
        movie: {
            id: movie.id,
            title: movie.title,
            tmdb_id: movie.tmdb_id,
            imdb_id: movie.imdb_id,
            jellyfin_id: movie.jellyfin_id,
            child_id: movie.child_id,
            play_count: movie.play_count
        },
        playback_history: history,
        trakt_history: traktHistory,
        trakt_by_title: traktByTitle,
        trakt_stats: { total_entries: traktTotal?.c || 0, queried_tmdb_id: movie.tmdb_id }
    });
}
