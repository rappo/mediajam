import db from '$lib/server/db.js';
import { error } from '@sveltejs/kit';
import { checkJellyfinFavorite } from '$lib/server/jellyfin-favorites.js';

/** @type {import('./$types').PageServerLoad} */
export async function load({ params, locals }) {
    const movieId = parseInt(params.id);
    const userId = locals.user?.id || 0;
    const settings = /** @type {any} */ (db.prepare('SELECT jellyfin_url, radarr_url, radarr_external_url FROM app_settings WHERE id = 1').get());
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
            mp.is_favorite,
            mp.wikipedia_url,
            mp.radarr_id,
            mp.arr_slug,
            mp.arr_monitored,
            mp.arr_quality_profile,
            mp.arr_has_file,
            mp.arr_status,
            mc.id as child_id,
            mc.watch_status,
            mc.play_count,
            mc.runtime_ticks,
            ROUND(mc.runtime_ticks / 10000000.0 / 60, 0) as local_runtime_minutes,
            mp.runtime_minutes as external_runtime_minutes,
            (SELECT th.trakt_slug FROM trakt_history th WHERE th.tmdb_id = mp.tmdb_id AND th.type = 'movie' AND th.trakt_slug != '' LIMIT 1) as trakt_slug
        FROM media_parents mp
        LEFT JOIN media_children mc ON mc.parent_id = mp.id
        WHERE mp.id = ? AND mp.media_type = 'movie'
    `).get(movieId));

    if (!movie) throw error(404, 'Movie not found');

    // Playback history for this movie
    const history = /** @type {any[]} */ (db.prepare(`
        SELECT ph.id, ph.timestamp, ph.source, ph.duration_consumed_seconds, ph.completion_pct
        FROM playback_history ph
        WHERE ph.media_id = ? AND ph.user_id = ?
        ORDER BY ph.timestamp IS NULL, ph.timestamp DESC
    `).all(movie.child_id || 0, userId));

    const totalPlays = history.length;
    const datedHistory = history.filter(h => h.timestamp);
    const firstWatched = datedHistory.length > 0 ? datedHistory[datedHistory.length - 1].timestamp : null;
    const lastWatched = datedHistory.length > 0 ? datedHistory[0].timestamp : null;

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

    // External ratings
    const externalRatings = /** @type {any[]} */ (db.prepare(`
        SELECT source, rating_type, value, vote_count, raw_value, fetched_at
        FROM external_ratings WHERE media_parent_id = ? ORDER BY source
    `).all(movieId));

    // Live Jellyfin favorite check
    const liveFavorite = await checkJellyfinFavorite(movie.jellyfin_id, 'media_parents', movie.id);

    // Runtime: prefer local (from file) over external (from TMDB)
    const runtime_minutes = movie.local_runtime_minutes || movie.external_runtime_minutes || null;
    const needsRuntimeFetch = !runtime_minutes && !!movie.tmdb_id;

    // Watchlist status
    const inWatchlist = !!db.prepare(
        'SELECT 1 FROM watchlist WHERE user_id = ? AND media_parent_id = ?'
    ).get(userId, movieId);

    return {
        movie: {
            ...movie,
            runtime_minutes,
            needsRuntimeFetch,
            is_favorite: liveFavorite ?? movie.is_favorite,
            // Effective watch status: if we have play history, it's watched regardless of Jellyfin
            watch_status: totalPlays > 0 ? 'watched' : movie.watch_status,
            play_count: Math.max(movie.play_count || 0, totalPlays),
            posterUrl,
            backdropUrl,
            // Auto-enrich when key data is missing
            needsEnrichment: !movie.overview && (!!movie.jellyfin_id || !!movie.tmdb_id),
        },
        history,
        stats: {
            totalPlays,
            firstWatched,
            lastWatched,
        },
        cast,
        crew,
        externalRatings,
        jellyfinUrl,
        arrUrl: (settings?.radarr_external_url || settings?.radarr_url || '').replace(/\/+$/, ''),
        arrService: 'radarr',
        inWatchlist
    };
}
