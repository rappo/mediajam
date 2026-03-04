import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';

/** @type {import('./$types').PageServerLoad} */
export function load({ params, locals }) {
    const movieId = parseInt(params.id);
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url FROM app_settings WHERE id = 1').get());
    const jellyfinUrl = settings?.jellyfin_url || '';

    // Movie parent + child info
    const movie = /** @type {any} */ (db.prepare(`
        SELECT
            mp.id,
            mp.title,
            mp.release_year,
            mp.poster_url,
            mp.overview,
            mp.tmdb_id,
            mp.imdb_id,
            mp.tvdb_id,
            mp.musicbrainz_id,
            mp.jellyfin_id,
            mp.collection_status,
            mp.jellyfin_user_rating,
            mc.id as child_id,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks,
            ROUND(mc.runtime_ticks / 10000000.0 / 60, 0) as runtime_minutes
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.id = ? AND mp.media_type = 'movie'
    `).get(movieId));

    if (!movie) throw error(404, 'Movie not found');

    // Playback history for this movie
    const history = /** @type {any[]} */ (db.prepare(`
        SELECT ph.timestamp, ph.source, ph.duration_consumed_seconds, ph.completion_pct
        FROM playback_history ph
        WHERE ph.media_id = ? AND ph.user_id = ?
        ORDER BY ph.timestamp DESC
    `).all(movie.child_id || 0, userId));

    const totalPlays = history.length;
    const firstWatched = history.length > 0 ? history[history.length - 1].timestamp : null;
    const lastWatched = history.length > 0 ? history[0].timestamp : null;

    // Poster URL from Jellyfin if available
    const posterUrl = movie.jellyfin_id
        ? `${jellyfinUrl}/Items/${movie.jellyfin_id}/Images/Primary?maxHeight=400`
        : movie.poster_url;

    // Backdrop from Jellyfin if available
    const backdropUrl = movie.jellyfin_id
        ? `${jellyfinUrl}/Items/${movie.jellyfin_id}/Images/Backdrop?maxWidth=1200`
        : null;

    // Cast & Crew
    const cast = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type = 'actor'
        ORDER BY pc.sort_order ASC
    `).all(movieId));

    const crew = /** @type {any[]} */ (db.prepare(`
        SELECT p.id, p.name, p.photo_url, p.tmdb_person_id,
               pc.role_type, pc.character_name, pc.sort_order
        FROM person_credits pc
        JOIN persons p ON pc.person_id = p.id
        WHERE pc.media_parent_id = ? AND pc.role_type != 'actor'
        ORDER BY pc.sort_order ASC
    `).all(movieId));

    return {
        movie: {
            ...movie,
            // Effective watch status: if we have play history, it's watched regardless of Jellyfin
            watch_status: totalPlays > 0 ? 'watched' : movie.watch_status,
            play_count: Math.max(movie.play_count || 0, totalPlays),
            posterUrl,
            backdropUrl
        },
        history,
        stats: {
            totalPlays,
            firstWatched,
            lastWatched,
        },
        cast,
        crew,
        jellyfinUrl
    };
}
