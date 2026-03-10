import db from '$lib/server/db.js';
import { json, error } from '@sveltejs/kit';

/**
 * GET /api/debug/trakt-check/:tmdbId
 * Query the Trakt API directly to check if a movie exists in the user's
 * watched list and/or history, bypassing our local DB.
 */
export async function GET({ params, locals }) {
    if (!locals.user) throw error(401, 'Unauthorized');

    const tmdbId = params.tmdbId;

    // Get Trakt credentials
    const identity = /** @type {any} */ (db.prepare(
        "SELECT access_token FROM user_identities WHERE user_id = ? AND provider = 'trakt'"
    ).get(locals.user.id));
    const settings = /** @type {any} */ (db.prepare(
        'SELECT trakt_client_id FROM app_settings WHERE id = 1'
    ).get());

    if (!identity?.access_token || !settings?.trakt_client_id) {
        throw error(400, 'Trakt not configured');
    }

    const headers = {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': settings.trakt_client_id,
        'Authorization': `Bearer ${identity.access_token}`
    };

    const results = {
        tmdb_id: tmdbId,
        trakt_lookup: null,
        watched_movies: null,
        movie_history: null,
        local_trakt_history: null
    };

    try {
        // 1. Look up the movie on Trakt by TMDB ID
        const lookupRes = await fetch(`https://api.trakt.tv/search/tmdb/${tmdbId}?type=movie`, { headers });
        if (lookupRes.ok) {
            const lookupData = await lookupRes.json();
            results.trakt_lookup = lookupData;

            // If we found the Trakt slug, check history for that specific movie
            if (lookupData.length > 0 && lookupData[0].movie?.ids?.trakt) {
                const traktId = lookupData[0].movie.ids.trakt;
                const slug = lookupData[0].movie.ids.slug;

                // 2. Check movie-specific history
                const historyRes = await fetch(
                    `https://api.trakt.tv/users/me/history/movies/${traktId}`,
                    { headers }
                );
                if (historyRes.ok) {
                    results.movie_history = await historyRes.json();
                }

                // 3. Check if movie is in the watched list
                const watchedRes = await fetch(
                    `https://api.trakt.tv/users/me/watched/movies`,
                    { headers }
                );
                if (watchedRes.ok) {
                    const allWatched = await watchedRes.json();
                    const thisMovie = allWatched.find(m => m.movie?.ids?.trakt === traktId);
                    results.watched_movies = thisMovie || { not_found: true, total_watched: allWatched.length };
                }
            }
        }
    } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) });
    }

    // 4. Check local DB
    results.local_trakt_history = db.prepare(
        "SELECT * FROM trakt_history WHERE tmdb_id = ? AND user_id = ? ORDER BY watched_at DESC"
    ).all(String(tmdbId), locals.user.id);

    return json(results);
}
